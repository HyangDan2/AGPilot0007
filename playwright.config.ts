import { defineConfig, devices } from '@playwright/test';

// Per-agent isolation (WO-CP2-00): Q01=5173, Q02=5273, Q03=5373, Q04=5473, Q05=5573.
const e2ePort = process.env.E2E_PORT || '5173';
const baseURL = `http://localhost:${e2ePort}`;
const reuseExistingServer = process.env.PW_REUSE_SERVER === '1';
const outputDir = process.env.PW_OUTPUT_DIR || '.private/e2e-artifacts';

const allProjects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
  {
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  },
  {
    name: 'mobile-chromium',
    use: { ...devices['Pixel 7'] },
  },
  {
    name: 'mobile-webkit',
    use: { ...devices['iPhone 14'] },
  },
];

const requestedProjects = (process.env.PW_PROJECT || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const projects = requestedProjects.length
  ? allProjects.filter((project) => requestedProjects.includes(project.name))
  : allProjects;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir,
  timeout: 35000,
  fullyParallel: false, // Run sequentially for stability on WebGL resources
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    command: `npm run dev -- --port ${e2ePort} --strictPort`,
    url: baseURL,
    reuseExistingServer,
    timeout: 30000,
  },
});
