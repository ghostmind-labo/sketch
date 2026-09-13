// A locked-down page: no network, inline code only, library inlined in <head>, content in <body>.
// If a board works here, it works in any sandboxed iframe or strict-CSP page.
export const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export function page(lib, body, { background = '#16161a', color = '#ececec', padding = '0' } = {}) {
  const inlined = lib.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<script>${inlined}</script>
<style>html,body{margin:0;background:${background};color:${color};font-family:system-ui,sans-serif}body{padding:${padding}}</style>
</head><body>
${body}
</body></html>`;
}
