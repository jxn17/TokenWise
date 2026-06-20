import { getCompressionResources } from '../src/utils/compression-resources';

describe('compression-resources', () => {
  it('should return correct tool for image category', () => {
    const tools = getCompressionResources('image');
    expect(tools).toBeDefined();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('Squoosh');
  });

  it('should return correct tool for video category', () => {
    const tools = getCompressionResources('video');
    expect(tools).toBeDefined();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('HandBrake');
  });

  it('should return correct tool for pdf category', () => {
    const tools = getCompressionResources('pdf');
    expect(tools).toBeDefined();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('Adobe Acrobat compress');
  });

  it('should return fallback tools for unknown category', () => {
    const tools = getCompressionResources('unknown');
    expect(tools).toBeDefined();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('7-Zip');
  });
});
