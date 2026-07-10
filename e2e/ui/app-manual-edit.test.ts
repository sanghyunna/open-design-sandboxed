import { expect, test } from '@playwright/test';
import { ensureRailOpen } from '@/playwright/rail';
import { routeAgents } from '@/playwright/mock-factory';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

const STORAGE_KEY = 'open-design:config';
const ACTIVE_ARTIFACT_PREVIEW_SELECTOR = '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-url-load"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible';

test.describe.configure({ timeout: 30_000 });

function artifactPreview(page: Page) {
  return page.locator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR).first();
}

function artifactPreviewFrame(page: Page) {
  return page.frameLocator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'mock',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        agentModels: {},
        privacyDecisionAt: 1,
        telemetry: { metrics: false, content: false, artifactManifest: false },
      }),
    );
  }, STORAGE_KEY);

  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        config: {
          onboardingCompleted: true,
          agentId: 'mock',
          skillId: null,
          designSystemId: null,
          agentModels: {},
          privacyDecisionAt: 1,
          telemetry: { metrics: false, content: false, artifactManifest: false },
        },
      },
    });
  });
});

test('[P0] manual edit left inspector previews and persists page and selected element styles', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit smoke');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  await expect(artifactPreview(page)).toBeVisible();
  const frame = artifactPreviewFrame(page);
  await expect(frame.getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  // Enter edit mode: the left chat panel becomes the manual-edit inspector.
  // With nothing selected the inspector shows the Page section, and the docked
  // toolbars no longer render above the preview canvas.
  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(frame.locator('html[data-od-edit-mode]')).toHaveCount(1);
  const inspector = page.locator('.manual-edit-left-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspectorSection(page, 'Page')).toBeVisible();
  await expect(inspector).toContainText('Background');
  await expect(page.locator('[data-testid="manual-edit-shape-toolbar"]')).toHaveCount(0);

  // Page edits round-trip through the inspector rows.
  await inspectorRow(page, 'Background').locator('input:not([type="color"])').fill('#eef2ff');
  await inspectorRow(page, 'Font').locator('select').selectOption('Georgia, serif');
  await inspectorRow(page, 'Base size').locator('input').fill('18');
  await expect(inspectorRow(page, 'Background').locator('input:not([type="color"])')).toHaveValue('#eef2ff');
  await expect(inspectorRow(page, 'Font').locator('select')).toHaveValue('Georgia, serif');
  await expect(inspectorRow(page, 'Base size').locator('input')).toHaveValue('18');

  // Selecting a text element swaps the Page section for Text + Shape sections.
  await selectPreviewElementThroughBridge(page, frame, '[data-od-id="hero-title"]', 'Text');
  await expect(inspectorSection(page, 'Shape')).toBeVisible();
  await expect(inspectorSection(page, 'Page')).toHaveCount(0);

  const fontSizeInput = inspectorSection(page, 'Text').locator('.cc-row').filter({ hasText: 'Font size' }).locator('input');
  await fontSizeInput.fill('48');
  await inspectorSection(page, 'Text').locator('.cc-row').filter({ hasText: 'Text color' }).locator('input:not([type="color"])').fill('#ef4444');
  await expect(fontSizeInput).toHaveValue('48');

  // Edits preview live on the selected element.
  const title = frame.getByRole('heading', { name: 'Original Hero' });
  await expect.poll(async () => title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('48px');
  await expect(title).toHaveCSS('color', 'rgb(239, 68, 68)');

  // Exiting edit mode flushes staged edits to the file and restores chat.
  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(page.locator('.manual-edit-left-inspector')).toHaveCount(0);
  await expectFileSource(page, projectId, 'manual-edit.html', [
    // Element edits (selected hero title): the browser serializes the applied
    // color as rgb() when the style attribute round-trips.
    'font-size: 48px',
    'rgb(239, 68, 68)',
    // Page edits (body) flushed when the element selection took over.
    'background-color: rgb(238, 242, 255)',
  ]);
  await expectFileSourceExcludes(page, projectId, 'manual-edit.html', ['data-od-edit-selected']);
  await expect(page.locator('.manual-edit-error')).toHaveCount(0);

  await expect(page.getByRole('button', { name: /^Share$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Download$/ })).toBeVisible();
});

test('[P0] manual edit direct text typing persists text-only elements', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit text typing');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  const frame = artifactPreviewFrame(page);
  const textOnlyDiv = frame.locator('[data-od-id="pair-a"]');
  await expect(textOnlyDiv).toHaveText('Left panel');

  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(frame.locator('html[data-od-edit-mode]')).toHaveCount(1);
  await textOnlyDiv.click();
  // Text-only elements open a formatting-capable (rich) contenteditable so
  // B/I/U can emit markup; only links/non-text leaves get plaintext-only.
  await expect(textOnlyDiv).toHaveAttribute('contenteditable', 'true');

  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Edited left panel');
  await page.keyboard.press('Enter');

  await expectFileSource(page, projectId, 'manual-edit.html', ['Edited left panel']);
  await expect(frame.getByText('Edited left panel')).toBeVisible();
});

test('[P0] manual edit mode preserves preview actions after style edits', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit smoke');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  await expect(artifactPreview(page)).toBeVisible();
  const frame = artifactPreviewFrame(page);
  await expect(frame.getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  await page.getByTestId('manual-edit-mode-toggle').click();
  await selectPreviewElementThroughBridge(page, frame, '[data-od-id="hero-title"]', 'Text');
  const fontSizeInput = await selectStyleRowInput(page, frame, '[data-od-id="hero-title"]', 'Text', 'Font size');
  await fontSizeInput.fill('48');

  // Exit edit mode to flush the staged style edit to the file.
  await page.getByTestId('manual-edit-mode-toggle').click();
  await expectFileSource(page, projectId, 'manual-edit.html', ['font-size: 48px']);
  await expect(frame.getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  await page.getByTestId('board-mode-toggle').click();
  await expect(page.getByRole('button', { name: /^Comment$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Share$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Download$/ })).toBeVisible();
});

test('[P1] manual edit resize handle drag grows selected element and persists width/height', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit resize smoke');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  const frame = artifactPreviewFrame(page);
  await expect(frame.getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  await page.getByTestId('manual-edit-mode-toggle').click();
  // The Shape section carries sizing controls; the resize handles overlay the
  // preview element itself, independent of where the controls are docked.
  await selectPreviewElementThroughBridge(page, frame, '[data-od-id="hero-title"]', 'Shape');

  const heroTitle = frame.locator('[data-od-id="hero-title"]');
  const before = await heroTitle.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });

  const handle = page.getByRole('button', { name: 'Resize bottom-right corner' });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error('resize handle has no bounding box');
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 80, { steps: 8 });
  await expect
    .poll(async () => heroTitle.evaluate((el) => (el as HTMLElement).style.width))
    .not.toBe('');
  await page.mouse.up();

  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/manual-edit.html`);
      if (!resp.ok()) return false;
      const source = await resp.text();
      const match = source.match(/data-od-id="hero-title"[^>]*style="([^"]*)"/);
      const style = match?.[1];
      if (!style) return false;
      const widthMatch = style.match(/width:\s*(\d+)px/);
      const heightMatch = style.match(/height:\s*(\d+)px/);
      const width = widthMatch?.[1];
      const height = heightMatch?.[1];
      if (!width || !height) return false;
      return Number(width) > Math.round(before.width) && Number(height) > Math.round(before.height);
    })
    .toBe(true);
  await expect(page.locator('.manual-edit-error')).toHaveCount(0);
});

test('[P1] issue 16 move browser verification', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Issue 16 move browser verification');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  const frame = artifactPreviewFrame(page);
  const image = frame.locator('[data-od-id="hero-image"]');
  await expect(image).toBeVisible();
  await page.getByTestId('manual-edit-mode-toggle').click();
  await expect(frame.locator('html[data-od-edit-mode]')).toHaveCount(1);
  await image.click();
  await expect(frame.locator('[data-od-id="hero-image"][data-od-edit-selected="true"]')).toHaveCount(1);

  const before = await image.boundingBox();
  if (!before) throw new Error('image has no bounding box before move');
  const moveSurface = page.getByRole('group', { name: 'Move element' }).locator('[data-region="interior"]');
  await expect(moveSurface).toBeVisible();
  const moveBox = await moveSurface.boundingBox();
  if (!moveBox) throw new Error('move surface has no bounding box');
  const startX = moveBox.x + moveBox.width / 2;
  const startY = moveBox.y + moveBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 40, { steps: 8 });
  await expect
    .poll(async () => {
      const current = await image.boundingBox();
      return current
        ? Math.abs((current.x - before.x) - 80) < 4
          && Math.abs((current.y - before.y) - 40) < 4
        : false;
    })
    .toBe(true);
  await page.mouse.up();

  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/manual-edit.html`);
      if (!resp.ok()) return '';
      const source = await resp.text();
      return source.match(/data-od-id="hero-image"[^>]*style="([^"]*)"/)?.[1] ?? '';
    })
    .toMatch(/translate:\s*80px\s+40px/);
  const moved = await image.boundingBox();
  if (!moved) throw new Error('image has no bounding box after move');
  expect(Math.abs((moved.x - before.x) - 80)).toBeLessThan(2);
  expect(Math.abs((moved.y - before.y) - 40)).toBeLessThan(2);

  await page.keyboard.press('Control+z');

  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/manual-edit.html`);
      if (!resp.ok()) return false;
      const source = await resp.text();
      const style = source.match(/data-od-id="hero-image"[^>]*style="([^"]*)"/)?.[1] ?? '';
      return !/\btranslate:/.test(style);
    })
    .toBe(true);
  const undone = await image.boundingBox();
  if (!undone) throw new Error('image has no bounding box after undo');
  expect(Math.abs(undone.x - before.x)).toBeLessThan(1);
  expect(Math.abs(undone.y - before.y)).toBeLessThan(1);
});

test('[P1] manual edit resize handles track the selected element through layout reflows', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit resize alignment');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  const frame = artifactPreviewFrame(page);
  await expect(frame.getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  await page.getByTestId('manual-edit-mode-toggle').click();
  await selectPreviewElementThroughBridge(page, frame, '[data-od-id="hero-title"]', 'Shape');

  const heroTitle = frame.locator('[data-od-id="hero-title"]');
  // Reflow the selected element WITHOUT a window resize or scroll — the shape
  // of deck slide navigation / transition settle / media-load reflows. The
  // bridge's layout observer must re-broadcast rects or the host overlays
  // (resize handles, inspector panel, hover icon) keep the stale click-time box.
  await heroTitle.evaluate((el) => {
    (el as HTMLElement).style.padding = '40px';
  });

  const seHandle = page.getByRole('button', { name: 'Resize bottom-right corner' });
  await expect(seHandle).toBeVisible();
  await expect
    .poll(async () => {
      const handleBox = await seHandle.boundingBox();
      const elementBox = await heroTitle.boundingBox();
      if (!handleBox || !elementBox) return Number.POSITIVE_INFINITY;
      const centerX = handleBox.x + handleBox.width / 2;
      const centerY = handleBox.y + handleBox.height / 2;
      return Math.hypot(
        centerX - (elementBox.x + elementBox.width),
        centerY - (elementBox.y + elementBox.height),
      );
    })
    .toBeLessThan(4);
});

test('[P1] manual edit resize pins flex-fill items so a width drag holds and handles track the element', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit resize flex pin');
  await seedHtmlArtifact(page, projectId, 'manual-edit.html', manualEditHtml());
  await page.goto(`/projects/${projectId}/files/manual-edit.html`);
  await openDesignFile(page, 'manual-edit.html');

  const frame = artifactPreviewFrame(page);
  await expect(frame.getByRole('heading', { name: 'Original Hero' })).toBeVisible();

  await page.getByTestId('manual-edit-mode-toggle').click();
  await selectPreviewElementThroughBridge(page, frame, '[data-od-id="pair-b"]', 'Shape');

  const pairB = frame.locator('[data-od-id="pair-b"]');
  const before = await pairB.boundingBox();
  if (!before) throw new Error('flex item has no bounding box');

  const eHandle = page.getByRole('button', { name: 'Resize right edge' });
  await expect(eHandle).toBeVisible();
  const box = await eHandle.boundingBox();
  if (!box) throw new Error('resize handle has no bounding box');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 60, startY, { steps: 6 });

  // `flex: 1 1 0` normally ignores a bare width; the drag preview pins the
  // item (flex: none), so the element's REAL box must follow the pointer…
  await expect
    .poll(async () => {
      const current = await pairB.boundingBox();
      return current ? Math.abs(current.width - (before.width - 60)) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(6);
  // …and the handle must track the element's measured edge (fed back through
  // the per-frame preview acks), not the raw cursor position.
  await expect
    .poll(async () => {
      const handleBox = await eHandle.boundingBox();
      const elementBox = await pairB.boundingBox();
      if (!handleBox || !elementBox) return Number.POSITIVE_INFINITY;
      return Math.abs((handleBox.x + handleBox.width / 2) - (elementBox.x + elementBox.width));
    })
    .toBeLessThan(4);
  await page.mouse.up();

  // The commit persists the width together with the flex pin, so the saved
  // file reproduces what the user saw on release.
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/manual-edit.html`);
      if (!resp.ok()) return '';
      const source = await resp.text();
      const match = source.match(/data-od-id="pair-b"[^>]*style="([^"]*)"/);
      return match?.[1] ?? '';
    })
    // Chromium serializes the `flex: none` shorthand as its longhand
    // equivalent `0 0 auto` when the style attribute round-trips.
    .toMatch(/width:\s*\d+px[^"]*flex:\s*(?:none|0 0 auto)|flex:\s*(?:none|0 0 auto)[^"]*width:\s*\d+px/);

  // Handles settle exactly on the element after release — no residual offset.
  await expect
    .poll(async () => {
      const handleBox = await eHandle.boundingBox();
      const elementBox = await pairB.boundingBox();
      if (!handleBox || !elementBox) return Number.POSITIVE_INFINITY;
      return Math.abs((handleBox.x + handleBox.width / 2) - (elementBox.x + elementBox.width));
    })
    .toBeLessThan(4);
  await expect(page.locator('.manual-edit-error')).toHaveCount(0);
});

async function selectPreviewElementThroughBridge(
  page: Page,
  frame: ReturnType<Page['frameLocator']>,
  selector: string,
  section: string,
) {
  await expect(frame.locator('html[data-od-edit-mode]')).toHaveCount(1);
  await frame.locator(selector).click();
  await expect(inspectorSection(page, section)).toBeVisible();
  await expect(frame.locator(`${selector}[data-od-edit-selected="true"]`)).toHaveCount(1);
}

async function selectStyleRowInput(
  page: Page,
  frame: ReturnType<Page['frameLocator']>,
  selector: string,
  section: string,
  label: string,
) {
  await frame.locator(selector).evaluate((el) => {
    const element = el as HTMLElement;
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    window.parent.postMessage({
      type: 'od-edit-select',
      target: {
        id: element.dataset.odId ?? element.id,
        kind: 'text',
        label: element.textContent?.trim() || element.tagName.toLowerCase(),
        tagName: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : '',
        text: element.textContent?.trim() ?? '',
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        fields: { text: element.textContent?.trim() ?? '' },
        attributes: Object.fromEntries(Array.from(element.attributes).map((attr) => [attr.name, attr.value])),
        styles: {
          fontFamily: styles.fontFamily,
          fontSize: styles.fontSize,
          fontWeight: styles.fontWeight,
          color: styles.color,
          textAlign: styles.textAlign,
          lineHeight: styles.lineHeight,
          letterSpacing: styles.letterSpacing,
          width: styles.width,
          height: styles.height,
          minHeight: styles.minHeight,
          gap: styles.gap,
          flexDirection: styles.flexDirection,
          justifyContent: styles.justifyContent,
          alignItems: styles.alignItems,
          backgroundColor: styles.backgroundColor,
          opacity: styles.opacity,
          padding: styles.padding,
          paddingTop: styles.paddingTop,
          paddingRight: styles.paddingRight,
          paddingBottom: styles.paddingBottom,
          paddingLeft: styles.paddingLeft,
          margin: styles.margin,
          marginTop: styles.marginTop,
          marginRight: styles.marginRight,
          marginBottom: styles.marginBottom,
          marginLeft: styles.marginLeft,
          border: styles.border,
          borderTopWidth: styles.borderTopWidth,
          borderRightWidth: styles.borderRightWidth,
          borderBottomWidth: styles.borderBottomWidth,
          borderLeftWidth: styles.borderLeftWidth,
          borderStyle: styles.borderStyle,
          borderColor: styles.borderColor,
          borderRadius: styles.borderRadius,
        },
        isLayoutContainer: false,
        outerHtml: element.outerHTML,
      },
    }, '*');
  });
  await expect(inspectorSection(page, section)).toBeVisible();
  const row = inspectorSection(page, section).locator('.cc-row').filter({ hasText: label }).locator('input');
  await expect(row).toBeVisible();
  return row;
}

test('[P0] manual edit mode keeps deck navigation available for deck-shaped HTML', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Manual edit deck smoke');
  await seedDeckArtifact(page, projectId, 'manual-deck.html', 'Manual Deck', ['Slide One', 'Slide Two']);
  await page.goto(`/projects/${projectId}/files/manual-deck.html`);
  await openDesignFile(page, 'manual-deck.html');

  const frame = artifactPreviewFrame(page);
  await expect(frame.getByText('Slide One')).toBeVisible();
  await page.getByLabel('Next slide').click();
  await expect(frame.getByText('Slide Two')).toBeVisible();
});


test('[P0] simple deck keeps the active slide stable across preview mode switches', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'Simple deck navigation state');
  await seedDeckArtifact(page, projectId, 'simple-deck.html', 'Simple Deck', ['Slide One', 'Slide Two', 'Slide Three']);
  await page.goto(`/projects/${projectId}/files/simple-deck.html`);
  await openDesignFile(page, 'simple-deck.html');

  const frame = artifactPreviewFrame(page);
  const viewModeTabs = page.getByRole('tablist', { name: 'View mode' });

  await expect(frame.getByText('Slide One')).toBeVisible();
  await page.getByLabel('Next slide').click();
  await expect(frame.getByText('Slide Two')).toBeVisible();

  await viewModeTabs.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.viewer-source')).toContainText('Slide Three');
  await viewModeTabs.getByRole('tab', { name: 'Preview' }).click();

  await expect(frame.getByText('Slide Two')).toBeVisible();
  await page.getByLabel('Next slide').click();
  await expect(frame.getByText('Slide Three')).toBeVisible();
});

test('[P0] @critical HTML preview stays rendered after switching from Preview to Code and back', async ({ page }) => {
  await routeMockAgents(page);
  const projectId = await createEmptyProject(page, 'HTML preview toggle regression');
  await seedHtmlArtifact(
    page,
    projectId,
    'toggle-preview.html',
    '<!doctype html><html><body><main><h1>Toggle Preview Stable</h1><p>Still visible after tab switches.</p></main></body></html>',
  );
  await page.goto(`/projects/${projectId}`);
  await openDesignFile(page, 'toggle-preview.html');

  const previewFrame = artifactPreview(page);
  await expect(previewFrame).toBeVisible();
  await expect(
    artifactPreviewFrame(page).getByRole('heading', { name: 'Toggle Preview Stable' }),
  ).toBeVisible();

  const viewModeTabs = page.getByRole('tablist', { name: 'View mode' });
  await viewModeTabs.getByRole('tab', { name: 'Code' }).click();
  await expect(page.locator('.viewer-source')).toContainText('Toggle Preview Stable');

  await viewModeTabs.getByRole('tab', { name: 'Preview' }).click();
  await expect(previewFrame).toBeVisible();
  await expect(
    artifactPreviewFrame(page).getByRole('heading', { name: 'Toggle Preview Stable' }),
  ).toBeVisible();
  await expect(
    artifactPreviewFrame(page).getByText('Still visible after tab switches.'),
  ).toBeVisible();
});

async function routeMockAgents(page: Page) {
  await routeAgents(page, [
    {
      id: 'mock',
      name: 'Mock Agent',
      bin: 'mock-agent',
      available: true,
      version: 'test',
      models: [{ id: 'default', label: 'Default' }],
    },
  ]);
}

async function createEmptyProject(page: Page, name: string): Promise<string> {
  await gotoEntryHome(page);
  await openNewProjectModal(page);
  await page.getByTestId('new-project-name').fill(name);
  await page.getByTestId('create-project').click();
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) throw new Error(`unexpected project route: ${current.pathname}`);
  return projectId;
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve Open Design' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function openNewProjectModal(page: Page) {
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-new-project').click();
  await expect(page.getByTestId('new-project-modal')).toBeVisible();
  await expect(page.getByTestId('new-project-panel')).toBeVisible();
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
  const resp = await page.request.post(
    `/api/projects/${projectId}/files`,
    {
      data: {
        name: fileName,
        content,
        artifactManifest: {
          version: 1,
          kind: 'html',
          title: fileName,
          entry: fileName,
          renderer: 'html',
          exports: ['html'],
        },
      },
      timeout: 15_000,
    },
  );
  expect(resp.ok()).toBeTruthy();
}

async function seedDeckArtifact(
  page: Page,
  projectId: string,
  fileName: string,
  title: string,
  slides: string[],
) {
  const slideHtml = slides
    .map((slide, index) => `<section class="slide" data-od-id="slide-${index + 1}"${index === 0 ? '' : ' hidden'}><h1>${slide}</h1></section>`)
    .join('\n');
  const resp = await page.request.post(
    `/api/projects/${projectId}/files`,
    {
      data: {
        name: fileName,
        content: `<!doctype html><html><body>${slideHtml}</body></html>`,
        artifactManifest: {
          version: 1,
          kind: 'deck',
          title,
          entry: fileName,
          renderer: 'deck-html',
          exports: ['html', 'pptx'],
        },
      },
      timeout: 15_000,
    },
  );
  expect(resp.ok()).toBeTruthy();
}

async function openDesignFile(page: Page, fileName: string) {
  const preview = artifactPreview(page);
  try {
    await preview.waitFor({ state: 'visible', timeout: 5_000 });
    return;
  } catch {
    // Not yet visible; try opening via tab or file list
  }

  const filePattern = new RegExp(fileName.replace(/\./g, '\\.'), 'i');
  const fileTabButton = page.getByRole('tab', { name: filePattern }).first();
  let tabFound = true;
  try {
    await fileTabButton.waitFor({ state: 'visible', timeout: 2_000 });
  } catch {
    tabFound = false;
  }

  if (tabFound) {
    await fileTabButton.click();
  } else {
    const fileButton = page.getByRole('button', { name: filePattern });
    await fileButton.click();
    await page.getByTestId('design-file-preview').getByRole('button', { name: 'Open' }).click();
  }
  await expect(preview).toBeVisible();
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText('Loading Open Design…').waitFor({ state: 'hidden', timeout: T.medium });
}

async function expectFileSource(page: Page, projectId: string, fileName: string, snippets: string[]) {
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/${fileName}`);
      if (!resp.ok()) return false;
      const source = await resp.text();
      return snippets.every((snippet) => source.includes(snippet));
    })
    .toBe(true);
}

async function expectFileSourceExcludes(page: Page, projectId: string, fileName: string, snippets: string[]) {
  await expect
    .poll(async () => {
      const resp = await page.request.get(`/api/projects/${projectId}/files/${fileName}`);
      if (!resp.ok()) return false;
      const source = await resp.text();
      return snippets.every((snippet) => !source.includes(snippet));
    })
    .toBe(true);
}

function inspectorRow(page: Page, label: string) {
  return page.locator('.manual-edit-left-inspector .cc-row').filter({ hasText: label }).first();
}

function inspectorSection(page: Page, title: string) {
  return page.locator('.manual-edit-left-inspector .cc-section').filter({ has: page.locator('.cc-section-head', { hasText: new RegExp(`^${title}$`, 'i') }) }).first();
}

function manualEditHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Manual Edit</title>
    <style>
      .responsive-pair { display: flex; gap: 24px; }
      .responsive-pair > div { flex: 1 1 0; min-height: 40px; }
      @media (max-width: 700px) {
        .responsive-pair { flex-direction: column; }
      }
    </style>
  </head>
  <body style="font-family: Inter, system-ui, sans-serif; font-size: 16px; letter-spacing: 0.01em;">
    <main>
      <section data-od-id="responsive-pair" data-od-label="Responsive pair" class="responsive-pair">
        <div data-od-id="pair-a">Left panel</div>
        <div data-od-id="pair-b">Right panel</div>
      </section>
      <section data-od-id="hero" data-od-label="Hero section" style="display:flex;gap:8px;align-items:center;">
        <h1 data-od-id="hero-title" data-od-label="Hero title">Original Hero</h1>
        <a data-od-id="cta" data-od-label="Primary CTA" href="/start">Start now</a>
        <img data-od-id="hero-image" data-od-label="Hero image" src="/hero.png" alt="Hero" style="width:64px;height:64px;">
      </section>
    </main>
  </body>
</html>`;
}
