// Desktop pad rumble the webview cannot do: WebView2's Gamepad API drives XInput (Xbox) pads, but a DualSense
// (PS5 pad) gets no effect, so the option 진동 did nothing on a PC with one. Here the motors are set with the
// pad's own HID output report (USB 0x02, Bluetooth 0x31 + CRC32), the layout SDL's hidapi_ps5 driver uses,
// and set back to 0 after `ms`. A later call restarts the time.
use hidapi::{BusType, HidApi};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

const SONY: u16 = 0x054c;
/// DualSense, DualSense Edge
const DUALSENSE: [u16; 2] = [0x0ce6, 0x0df2];

static API: Mutex<Option<HidApi>> = Mutex::new(None);
static GEN: AtomicU64 = AtomicU64::new(0);

/// Both motors at full strength for `ms`, on every connected DualSense.
pub fn rumble(ms: u32) {
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    set(255, 255);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms as u64));
        if GEN.load(Ordering::SeqCst) == gen {
            set(0, 0);
        }
    });
}

/// motors of every connected DualSense; the number of pads written
fn set(left: u8, right: u8) -> usize {
    let Ok(mut guard) = API.lock() else { return 0 };
    if guard.is_none() {
        *guard = HidApi::new().ok();
    }
    let Some(api) = guard.as_mut() else { return 0 };
    if api.refresh_devices().is_err() {
        return 0;
    }
    let mut n = 0;
    for info in api.device_list() {
        if info.vendor_id() != SONY || !DUALSENSE.contains(&info.product_id()) {
            continue;
        }
        let Ok(dev) = info.open_device(api) else { continue };
        if dev.write(&report(matches!(info.bus_type(), BusType::Bluetooth), left, right)).is_ok() {
            n += 1;
        }
    }
    n
}

/// Output report with the "compatible vibration" bits (enable rumble, rumble instead of audio haptics).
fn report(bluetooth: bool, left: u8, right: u8) -> Vec<u8> {
    if bluetooth {
        let mut r = vec![0u8; 78];
        r[0] = 0x31;
        r[1] = 0x02; // tag: the effects block follows
        effects(&mut r[2..], left, right);
        let crc = crc32(&[&[0xa2u8][..], &r[..74]]);
        r[74..78].copy_from_slice(&crc.to_le_bytes());
        r
    } else {
        let mut r = vec![0u8; 48];
        r[0] = 0x02;
        effects(&mut r[1..], left, right);
        r
    }
}

fn effects(e: &mut [u8], left: u8, right: u8) {
    e[0] = 0x01 | 0x02; // enable rumble emulation, use the motors (not the audio haptics)
    e[2] = right; // high-frequency (weak) motor
    e[3] = left; // low-frequency (strong) motor
}

/// CRC-32 (IEEE) over the parts in order: the Bluetooth report is checked with the 0xa2 output header in front.
fn crc32(parts: &[&[u8]]) -> u32 {
    let mut c = !0u32;
    for p in parts {
        for &b in *p {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { (c >> 1) ^ 0xedb8_8320 } else { c >> 1 };
            }
        }
    }
    !c
}

#[cfg(test)]
mod tests {
    /// manual check with a DualSense connected: `cargo test rumble -- --ignored` buzzes it for half a second
    #[test]
    #[ignore]
    fn rumble_connected_pad() {
        assert!(super::set(255, 255) > 0, "no DualSense written");
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert!(super::set(0, 0) > 0);
    }

    #[test]
    fn bluetooth_report_crc() {
        // the CRC covers the 0xa2 header and the first 74 bytes, stored little-endian at 74..78
        let r = super::report(true, 255, 255);
        assert_eq!((r.len(), r[0], r[2], r[4], r[5]), (78, 0x31, 0x03, 255, 255));
        assert_eq!(u32::from_le_bytes(r[74..78].try_into().unwrap()), super::crc32(&[&[0xa2], &r[..74]]));
        assert_eq!(super::crc32(&[b"123456789"]), 0xcbf4_3926);
    }
}
