import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderAll } from '../render-previews';

describe('renderAll', () => {
  it('writes every Sport preview variant as real HTML rendered from the sport template', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sport-preview-'));
    const previousCwd = process.cwd();
    process.chdir(outDir);

    try {
      await renderAll();

      const allDistricts = fs.readFileSync(path.join(outDir, 'preview', 'sport-all-districts.html'), 'utf-8');
      expect(allDistricts).toContain('<h1>Sport</h1>');
      expect(allDistricts).toContain('Marieke Jansen');

      const empty = fs.readFileSync(path.join(outDir, 'preview', 'sport-empty.html'), 'utf-8');
      expect(empty).toContain('Er zijn geen Sportaanmeldingen');

      const partialError = fs.readFileSync(path.join(outDir, 'preview', 'sport-partial-error.html'), 'utf-8');
      expect(partialError).toContain('utrecht-alert--warning');
      expect(partialError).toContain('OF-2026-00120 (document 3f9c9e2a-1b4d-4e9a-8f2b-6a7d5c8e9f10)');

      expect(fs.existsSync(path.join(outDir, 'preview', 'sport-dukenburg.html'))).toBe(true);

      const filtered = fs.readFileSync(path.join(outDir, 'preview', 'sport-filtered.html'), 'utf-8');
      expect(filtered).toContain('name="district"');
      expect(filtered).toContain('name="type"');

      const contentVariety = fs.readFileSync(path.join(outDir, 'preview', 'sport-content-variety.html'), 'utf-8');
      expect(contentVariety).toContain('nijmegen-search-results');
      expect(contentVariety).toContain('Bram de Wit-Vermeulen');
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
