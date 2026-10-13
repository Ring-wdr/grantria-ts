// Web-standard globals every target JS runtime has (browsers, webviews, Node 18+) but the ES library
// types do not declare. Core reaches them only through here, so it compiles without the DOM types.
const g = globalThis as unknown as {
  TextDecoder: new (label: string) => { decode(b: Uint8Array): string };
  atob(s: string): string;
  btoa(s: string): string;
};

export const decodeText = (label: string, b: Uint8Array): string => new g.TextDecoder(label).decode(b);
export const base64 = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return g.btoa(s); };
export const unbase64 = (s: string): Uint8Array => Uint8Array.from(g.atob(s), (c) => c.charCodeAt(0));
