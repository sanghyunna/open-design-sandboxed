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

export function magneticEdgeAlignmentHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Magnetic edge alignment</title>
    <style>
      .snap-stage { position: relative; width: 400px; height: 300px; background: #f8fafc; }
      .snap-box { position: absolute; width: 80px; height: 60px; }
      .snap-source { left: 40px; top: 40px; background: #bfdbfe; }
      .snap-target { left: 215px; top: 140px; background: #bbf7d0; }
    </style>
  </head>
  <body>
    <main>
      <section class="snap-stage" data-od-id="snap-stage" data-od-label="Snap stage">
        <div class="snap-box snap-source" data-od-id="snap-source" data-od-label="Snap source"><span>Source</span></div>
        <div class="snap-box snap-target" data-od-id="snap-target" data-od-label="Snap target" data-od-edit="container"><span>Target</span></div>
      </section>
    </main>
  </body>
</html>`;
}
