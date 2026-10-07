const TEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "—": "---",
  "–": "--",
  "₹": "\\rupee{}",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
};

// LaTeX escape: escape characters that have special meaning in LaTeX. One
// pass, so the braces a replacement introduces are never escaped again.
export function escTex(s: string): string {
  return s.replace(/[\\&%$#_{}~^—–₹“”‘’]/g, (c) => TEX_ESCAPES[c]);
}
