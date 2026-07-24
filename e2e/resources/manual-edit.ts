export function issue41SelectionPaintHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Issue 41 selection paint</title>
    <style>
      .authored-paint {
        outline: 3px dashed rgb(22, 163, 74);
        outline-offset: 1px;
        box-shadow: 0 0 0 3px rgb(168, 85, 247);
      }
      .authored-inline.authored-outline.authored-shadow {
        outline: 3px double rgb(220, 38, 38) !important;
        outline-offset: 2px;
        box-shadow: 0 0 0 5px rgb(14, 165, 233);
      }
    </style>
  </head>
  <body>
    <img
      class="authored-paint"
      data-od-id="issue-41-image"
      data-od-label="Authored image"
      alt="Authored image"
      style="display:block;width:96px;height:72px;background:#cbd5e1;"
    >
    <p data-od-id="issue-41-text" data-od-label="Inline text">Inline text</p>
    <p
      class="authored-inline authored-outline authored-shadow"
      data-od-id="issue-41-authored-text"
      data-od-label="Authored inline text"
    >Authored inline text</p>
  </body>
</html>`;
}
