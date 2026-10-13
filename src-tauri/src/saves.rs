// Saves: one file per store key in <app data>/saves. Each write goes to a temporary file that is synced and
// renamed over the old one, so a crash mid-write keeps the previous value, and a broken file loses only its
// own key, not every slot (the single plugin-store file of earlier builds could take them all).
use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const DIR: &str = "saves";
/// the tauri-plugin-store file earlier builds kept every key in; moved over on the first load
const LEGACY: &str = "grantria.json";

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// key -> file name: [A-Za-z0-9._-] stay, every other byte becomes %XX
fn file_name(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 200 || key.starts_with('.') {
        return Err(format!("bad save key {key:?}"));
    }
    let mut s = String::with_capacity(key.len() + 5);
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || b"._-".contains(&b) {
            s.push(b as char);
        } else {
            s.push_str(&format!("%{b:02X}"));
        }
    }
    Ok(s + ".json")
}

fn key_of(name: &str) -> Option<String> {
    let b = name.strip_suffix(".json")?.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn put(dir: &Path, key: &str, value: Option<&str>) -> Result<(), String> {
    let path = dir.join(file_name(key)?);
    match value {
        Some(v) => write_atomic(&path, v.as_bytes()),
        None => match fs::remove_file(&path) {
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            r => r,
        },
    }
    .map_err(|e| format!("{key}: {e}"))
}

/// every key in the save folder; a file that cannot be read is skipped (and logged), not fatal
#[tauri::command]
pub async fn saves_load(app: AppHandle) -> Result<HashMap<String, String>, String> {
    load(&app_data(&app)?)
}

fn load(base: &Path) -> Result<HashMap<String, String>, String> {
    let dir = base.join(DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut out = HashMap::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let Some(key) = name.to_str().and_then(key_of) else { continue };
        match fs::read_to_string(entry.path()) {
            Ok(v) => { out.insert(key, v); }
            Err(e) => eprintln!("save {key}: {e}"),
        }
    }
    let legacy = base.join(LEGACY);
    if out.is_empty() && legacy.exists() {
        let text = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
        let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&text).map_err(|e| format!("{LEGACY}: {e}"))?;
        for (k, v) in map {
            if let serde_json::Value::String(v) = v {
                put(&dir, &k, Some(&v))?;
                out.insert(k, v);
            }
        }
        // kept beside the new folder, never over an earlier one
        let done = (0..).map(|i| base.join(if i == 0 { format!("{LEGACY}.migrated") } else { format!("{LEGACY}.migrated.{i}") }))
            .find(|p| !p.exists()).unwrap();
        fs::rename(&legacy, done).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// [key, value] pairs in order; a null value deletes the key. Every pair is tried; the first error is returned.
#[tauri::command]
pub async fn saves_write(app: AppHandle, entries: Vec<(String, Option<String>)>) -> Result<(), String> {
    write(&app_data(&app)?, &entries)
}

fn write(base: &Path, entries: &[(String, Option<String>)]) -> Result<(), String> {
    let dir = base.join(DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut first = Ok(());
    for (k, v) in entries {
        let r = put(&dir, k, v.as_deref());
        if first.is_ok() { first = r; }
    }
    first
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for k in ["grantria.save.0", "grantria.option.raw", "grantria.x/y z", "grantria.한글"] {
            assert_eq!(key_of(&file_name(k).unwrap()).as_deref(), Some(k));
        }
        assert_eq!(file_name("grantria.x/y").unwrap(), "grantria.x%2Fy.json");
        assert!(file_name("").is_err() && file_name("..").is_err());
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("grantria-saves-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn moves_the_store_file_over_once() {
        let base = temp("migrate");
        fs::write(base.join(LEGACY), r#"{"grantria.save.0":"{\"level\":3}","grantria.option":"{}","other":1}"#).unwrap();
        fs::write(base.join(format!("{LEGACY}.migrated")), "older").unwrap();
        let m = load(&base).unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!(m["grantria.save.0"], r#"{"level":3}"#);
        assert!(!base.join(LEGACY).exists());
        assert_eq!(fs::read_to_string(base.join(format!("{LEGACY}.migrated"))).unwrap(), "older");
        assert!(base.join(format!("{LEGACY}.migrated.1")).exists());
        // the next start reads the folder
        assert_eq!(load(&base).unwrap(), m);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn writes_replace_and_delete() {
        let base = temp("write");
        write(&base, &[("grantria.a".into(), Some("1".into())), ("grantria.b".into(), Some("2".into()))]).unwrap();
        write(&base, &[("grantria.a".into(), Some("3".into())), ("grantria.b".into(), None), ("grantria.c".into(), None)]).unwrap();
        let m = load(&base).unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!(m["grantria.a"], "3");
        assert!(fs::read_dir(base.join(DIR)).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
        fs::remove_dir_all(&base).unwrap();
    }
}
