import { estimateFileTokens, detectURLs, generateFileTooltip } from '../src/utils/media-estimator';

describe('media-estimator', () => {
  describe('estimateFileTokens', () => {
    it('should correctly estimate tokens for images based on size', () => {
      const estimate = estimateFileTokens('image.png', 50000, 'image/png', 512, 512);
      expect(estimate.category).toBe('image');
      expect(estimate.estimatedTokens).toBeGreaterThan(0);
      expect(estimate.optimizationTips.length).toBeGreaterThan(0);
      expect(estimate.optimizationTips[0]).toMatch(/If the image contains text, paste the text directly instead/);
    });

    it('should estimate tokens for videos based on duration approximation', () => {
      // For a 5MB video
      const estimate = estimateFileTokens('video.mp4', 5 * 1024 * 1024, 'video/mp4');
      expect(estimate.category).toBe('video');
      expect(estimate.estimatedTokens).toBe(-1); // Unknown token cost for large videos without duration
      expect(estimate.optimizationTips[0]).toMatch(/Extract transcript and paste only the relevant section/);
    });

    it('should estimate tokens for spreadsheets and documents', () => {
      const xlsx = estimateFileTokens('data.xlsx', 100000, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(xlsx.category).toBe('spreadsheet');
      expect(xlsx.optimizationTips[0]).toMatch(/Export a CSV with only required columns/);

      const docx = estimateFileTokens('report.docx', 200000, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(docx.category).toBe('document');
      expect(docx.optimizationTips[0]).toMatch(/Copy only the chapter or section you need/);
    });

    it('should identify code and text files correctly', () => {
      const md = estimateFileTokens('readme.md', 10000, 'text/markdown');
      expect(md.category).toBe('text');
      // ~4 chars per token for text -> 2500
      expect(md.estimatedTokens).toBeCloseTo(10000 / 4, -3);
    });
  });

  describe('detectURLs', () => {
    it('should detect youtube urls', () => {
      const urls = detectURLs('Check out this video https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(urls).toHaveLength(1);
      expect(urls[0].type).toBe('youtube');
      expect(urls[0].tip).toMatch(/YouTube links load full transcripts/);
    });

    it('should detect generic urls', () => {
      const urls = detectURLs('Read this https://example.com/article');
      expect(urls).toHaveLength(1);
      expect(urls[0].type).toBe('general');
    });
  });

  describe('generateFileTooltip', () => {
    it('should format tooltip correctly', () => {
      const estimate = estimateFileTokens('image.png', 50000, 'image/png', 512, 512);
      const tooltip = generateFileTooltip(estimate);
      expect(tooltip).toContain('image.png');
      expect(tooltip).toContain('~');
      expect(tooltip).toContain('tokens');
    });
  });
});
