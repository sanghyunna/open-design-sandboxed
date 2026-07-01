import { expect, test } from '@playwright/test';
import { ensureRailOpen } from '@/playwright/rail';
import { routeAgents } from '@/playwright/mock-factory';
import type { Locator, Page } from '@playwright/test';

const STORAGE_KEY = 'open-design:config';

const CONNECTORS = [
  {
    id: 'github',
    name: 'GitHub',
    provider: 'composio',
    category: 'Developer tools',
    description: 'Read repository issues and pull requests.',
    status: 'available',
    auth: { provider: 'composio', configured: true },
    tools: [
      {
        name: 'list_issues',
        title: 'List issues',
        description: 'List recent issues from a repository.',
        safety: {
          sideEffect: 'read',
          approval: 'auto',
          reason: 'Read-only issue lookup.',
        },
        refreshEligible: true,
      },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    provider: 'composio',
    category: 'Communication',
    description: 'Search channels and messages.',
    status: 'connected',
    accountLabel: 'design-team',
    auth: { provider: 'composio', configured: true },
    tools: [],
  },
];

async function readSavedConfig(page: Page) {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, STORAGE_KEY);
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
      }),
    );
  }, STORAGE_KEY);

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
});

test('[P2] connectors search supports empty results and keyboard-closeable details', async ({ page }) => {
  await routeConnectors(page, CONNECTORS);
  await routeComposioConfig(page, { configured: true, apiKeyTail: '1234' });
  await page.addInitScript((key) => {
    const next = {
      mode: 'daemon',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      agentId: 'mock',
      skillId: null,
      designSystemId: null,
      onboardingCompleted: true,
      agentModels: {},
      composio: {
        apiKey: '',
        apiKeyConfigured: true,
        apiKeyTail: '1234',
      },
    };
    window.localStorage.setItem(key, JSON.stringify(next));
  }, STORAGE_KEY);

  await gotoEntryHome(page);
  const settingsDialog = await openIntegrationsConnectors(page);

  const search = settingsDialog.getByTestId('connectors-search-input');
  await search.fill('git');
  await expect(connectorCard(settingsDialog, 'github')).toBeVisible();
  await expect(connectorCard(settingsDialog, 'slack')).toHaveCount(0);

  await search.fill('missing connector');
  await expect(settingsDialog.getByTestId('connectors-empty')).toBeVisible();
  await settingsDialog.getByTestId('connectors-search-clear').click();
  await expect(settingsDialog.getByTestId('connectors-empty')).toHaveCount(0);
  await expect(connectorCard(settingsDialog, 'github')).toBeVisible();
  await expect(connectorCard(settingsDialog, 'slack')).toBeVisible();

  await connectorCard(settingsDialog, 'github').focus();
  await connectorCard(settingsDialog, 'github').press('Enter');
  await expect(page.getByTestId('connector-drawer')).toBeVisible();
  await expect(page.getByTestId('connector-drawer')).toContainText('List issues');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('connector-drawer')).toHaveCount(0);
});

test('[P0] saving a Composio key from Integrations unlocks the connectors gate immediately', async ({ page }) => {
  const { accountLabel: _unusedAccountLabel, ...slackConnector } = CONNECTORS[1]!;
  await routeConnectors(page, [
    {
      ...CONNECTORS[0]!,
      status: 'available',
      auth: { provider: 'composio', configured: false },
    },
    {
      ...slackConnector,
      status: 'available',
      auth: { provider: 'composio', configured: false },
    },
  ]);

  let savedComposioBody: unknown = null;
  await page.route('**/api/connectors/composio/config', async (route) => {
    savedComposioBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, body: '{}' });
  });
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: { config: null } });
      return;
    }
    await route.fulfill({ status: 200, body: '{}' });
  });

  await gotoEntryHome(page);
  const settingsDialog = await openIntegrationsConnectors(page);
  await expect(settingsDialog.getByTestId('connectors-search-input')).toBeDisabled();

  await settingsDialog.getByPlaceholder('Paste Composio API key').fill('cmp-secret-1234');
  await settingsDialog.getByRole('button', { name: 'Save key', exact: true }).click();

  expect(savedComposioBody).toEqual({ apiKey: 'cmp-secret-1234' });
  await expect(settingsDialog.getByTestId('connectors-search-input')).toBeEnabled();
  await expect(connectorCard(settingsDialog, 'github')).toBeVisible();

  await expect.poll(async () => readSavedConfig(page)).toMatchObject({
    composio: {
      apiKey: '',
      apiKeyConfigured: true,
      apiKeyTail: '1234',
    },
  });
  const savedConfig = await readSavedConfig(page);
  expect(savedConfig?.composio).toMatchObject({
    apiKey: '',
    apiKeyConfigured: true,
    apiKeyTail: '1234',
  });
  expect(savedConfig?.composio?.apiKey).toBe('');
});

test('[P1] typing a draft replacement Composio key does not trigger global autosave', async ({ page }) => {
  await routeConnectors(page, CONNECTORS);
  await routeComposioConfig(page, { configured: true, apiKeyTail: '1234' });
  await page.addInitScript((key) => {
    const next = {
      mode: 'daemon',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      agentId: 'mock',
      skillId: null,
      designSystemId: null,
      onboardingCompleted: true,
      agentModels: {},
      composio: {
        apiKey: '',
        apiKeyConfigured: true,
        apiKeyTail: '1234',
      },
    };
    window.localStorage.setItem(key, JSON.stringify(next));
  }, STORAGE_KEY);

  const appConfigPersistBodies: unknown[] = [];
  await page.route('**/api/app-config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, json: { config: null } });
      return;
    }
    appConfigPersistBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, body: '{}' });
  });

  await gotoEntryHome(page);
  const settingsDialog = await openIntegrationsConnectors(page);
  await expect(settingsDialog.getByTestId('connector-grid-wrap')).toBeVisible();
  await expect(settingsDialog.getByText('Saved · ••••1234')).toBeVisible();

  await page.waitForTimeout(1200);
  const appConfigPersistCountBeforeDraftEdit = appConfigPersistBodies.length;

  const replacementInput = settingsDialog.getByPlaceholder('Paste a new key to replace the saved one');
  await replacementInput.fill('cmp-draft-secret-9999');
  await expect(settingsDialog.getByRole('button', { name: 'Save key', exact: true })).toBeEnabled();

  await page.waitForTimeout(900);
  expect(appConfigPersistBodies).toHaveLength(appConfigPersistCountBeforeDraftEdit);
  const savedConfig = await readSavedConfig(page);
  expect(savedConfig?.composio).toMatchObject({
    apiKey: '',
    apiKeyConfigured: true,
    apiKeyTail: '1234',
  });
});

async function routeConnectors(page: Page, connectors: typeof CONNECTORS) {
  await page.route('**/api/connectors', async (route) => {
    await route.fulfill({ json: { connectors } });
  });
  await page.route('**/api/connectors/status', async (route) => {
    const statuses = Object.fromEntries(
      connectors.map((connector) => [
        connector.id,
        {
          status: connector.status,
          accountLabel: connector.accountLabel,
        },
      ]),
    );
    await route.fulfill({ json: { statuses } });
  });
  await page.route('**/api/connectors/discovery*', async (route) => {
    await route.fulfill({
      json: {
        connectors,
        meta: { provider: 'composio' },
      },
    });
  });
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function openIntegrationsConnectors(page: Page): Promise<Locator> {
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-integrations').click();
  await expect(page).toHaveURL(/\/integrations$/);
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
  await page.getByTestId('integrations-tab-connectors').click();
  await expect(page.getByTestId('integrations-tab-connectors')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const panel = page.locator('.integrations-view__panel');
  await expect(panel.getByTestId('connector-grid-wrap')).toBeVisible();
  return panel;
}

async function routeComposioConfig(
  page: Page,
  config: { configured: boolean; apiKeyTail?: string },
) {
  await page.route('**/api/connectors/composio/config', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: config });
      return;
    }

    await route.fulfill({ json: { ok: true } });
  });
}

function connectorCard(scope: Page | Locator, id: string) {
  return scope.locator(`article.connector-card[data-connector-id="${id}"]`);
}
