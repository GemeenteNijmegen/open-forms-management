import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderAll } from '../render-previews';

describe('renderAll', () => {
  it('renders every preview without throwing, with the Sport shell embedding a styled submissions fragment', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sport-preview-'));
    const previousCwd = process.cwd();
    process.chdir(outDir);

    try {
      await renderAll();

      const allDistricts = fs.readFileSync(path.join(outDir, 'preview', 'sport-all-districts.html'), 'utf-8');
      expect(allDistricts).toContain('<h1>Sport</h1>');
      // The fragment is embedded directly (no live backend in a preview), so its content is already in the page.
      expect(allDistricts).toContain('Testkind Dukenburg');
      expect(allDistricts).not.toContain('sport-submissions.js');
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
