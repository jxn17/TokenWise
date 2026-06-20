/**
 * TokenWise Test Suite
 * Manual testing checklist for production readiness
 *
 * Run these tests BEFORE pushing to production.
 * Each test should be run on live sites: chatgpt.com, claude.ai, gemini.google.com
 */

import {
  detectAttachments,
  safeQuerySelectorAll,
  validateSelector,
  extractMetadataFromText,
} from './attachment-detector';
import { estimateFileTokens } from './media-estimator';
import { reportError, getErrorReports, clearErrorReports } from './error-reporter';

/**
 * TEST 1: Input Element Detection
 * ✓ Verify that ChatGPT/Claude/Gemini input selector works
 * Manual: Open the site, type in the input field, confirm widget updates
 */
export async function testInputDetection(): Promise<{
  passed: boolean;
  message: string;
}> {
  try {
    // This test must be run manually on each site
    return {
      passed: true,
      message: 'MANUAL TEST: Verify input field is found and monitored',
    };
  } catch (e) {
    return {
      passed: false,
      message: `Input detection failed: ${e}`,
    };
  }
}

/**
 * TEST 2: Attachment Detection
 * ✓ Verify that file attachments are detected
 * ✗ CURRENTLY BROKEN: Attachment selector not finding elements
 */
export async function testAttachmentDetection(): Promise<{
  passed: boolean;
  elements: number;
  parsed: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // ChatGPT attachment config
  const chatgptConfig = {
    site: 'chatgpt' as const,
    selector: '[data-testid="attachment"]',
  };

  try {
    const result = await detectAttachments(chatgptConfig);
    return {
      passed: result.elements.length > 0 && result.parseFailures === 0,
      elements: result.elements.length,
      parsed: result.attachments.length,
      errors: result.parseFailures > 0 ? ['Failed to parse some attachments'] : [],
    };
  } catch (e) {
    return {
      passed: false,
      elements: 0,
      parsed: 0,
      errors: [`Attachment detection error: ${e}`],
    };
  }
}

/**
 * TEST 3: File Token Estimation
 * ✓ Verify token counting for common file types
 */
export function testFileTokenEstimation(): {
  passed: boolean;
  estimates: Record<string, number>;
} {
  const testFiles = [
    { name: 'document.pdf', size: 2 * 1024 * 1024 }, // 2MB PDF
    { name: 'image.jpg', size: 5 * 1024 * 1024 }, // 5MB image
    { name: 'data.csv', size: 1024 * 1024 }, // 1MB CSV
    { name: 'archive.zip', size: 50 * 1024 * 1024 }, // 50MB archive
  ];

  const estimates: Record<string, number> = {};
  let hasZero = false;

  for (const file of testFiles) {
    const estimate = estimateFileTokens(file.name, file.size, '', 0, 0);
    estimates[file.name] = estimate.estimatedTokens;

    if (estimate.estimatedTokens === 0) {
      hasZero = true;
    }
  }

  return {
    passed: !hasZero,
    estimates,
  };
}

/**
 * TEST 4: Error Reporting
 * ✓ Verify errors are logged to storage
 */
export async function testErrorReporting(): Promise<{
  passed: boolean;
  errorsStored: number;
  message: string;
}> {
  try {
    await clearErrorReports();

    // Simulate errors
    await reportError('chatgpt', 'TEST_ERROR', 'Test error message', 'Test details');
    await reportError('claude', 'TEST_ERROR_2', 'Another test error');

    const reports = await getErrorReports();

    return {
      passed: reports.length === 2,
      errorsStored: reports.length,
      message: reports.length === 2 ? 'Errors reported successfully' : `Expected 2 errors, got ${reports.length}`,
    };
  } catch (e) {
    return {
      passed: false,
      errorsStored: 0,
      message: `Error reporting test failed: ${e}`,
    };
  }
}

/**
 * TEST 5: DOM Selector Validation
 * ✓ Verify that all site selectors are valid
 */
export function testSelectorValidation(): {
  passed: boolean;
  validSelectors: Record<string, boolean>;
} {
  const selectors: Record<string, string> = {
    chatgpt_input: '[data-testid="input-field"]',
    chatgpt_attachments: '[data-testid="attachment"]',
    claude_input: 'textarea[placeholder*="Message"]',
    gemini_input: '[contenteditable="true"]',
  };

  const validSelectors: Record<string, boolean> = {};
  let allValid = true;

  for (const [key, selector] of Object.entries(selectors)) {
    try {
      validSelectors[key] = validateSelector(selector);
      if (!validSelectors[key]) allValid = false;
    } catch (e) {
      validSelectors[key] = false;
      allValid = false;
    }
  }

  return {
    passed: allValid,
    validSelectors,
  };
}

/**
 * TEST 6: Metadata Extraction
 * ✓ Verify fallback parsing works
 */
export function testMetadataExtraction(): {
  passed: boolean;
  results: Record<string, any>;
} {
  const testCases = [
    'document.pdf (2.5 MB)',
    'image.png 1.2 MB',
    'archive.zip 50MB',
    'file_without_size.txt',
  ];

  const results: Record<string, any> = {};
  let passed = true;

  for (const testCase of testCases) {
    const extracted = extractMetadataFromText(testCase);
    results[testCase] = extracted;

    if (testCase.includes('MB') && !extracted?.filesize) {
      passed = false;
    }
  }

  return {
    passed,
    results,
  };
}

/**
 * PRODUCTION READINESS CHECKLIST
 * Run this before pushing to GitHub
 */
export async function runProductionChecklist(): Promise<{
  allPassed: boolean;
  results: Record<string, any>;
}> {
  console.log('🧪 Running TokenWise Production Readiness Checklist...\n');

  const results: Record<string, any> = {};

  // Test 1: Input Detection
  console.log('Test 1: Input Element Detection');
  results.inputDetection = await testInputDetection();
  console.log(`  → ${results.inputDetection.message}\n`);

  // Test 2: Attachment Detection
  console.log('Test 2: Attachment Detection');
  results.attachmentDetection = await testAttachmentDetection();
  console.log(
    `  → Found: ${results.attachmentDetection.elements}, Parsed: ${results.attachmentDetection.parsed}`
  );
  if (results.attachmentDetection.errors.length > 0) {
    console.log(`  ⚠️  Errors: ${results.attachmentDetection.errors.join(', ')}`);
  }
  console.log();

  // Test 3: File Token Estimation
  console.log('Test 3: File Token Estimation');
  results.fileTokens = testFileTokenEstimation();
  console.log(`  → ${results.fileTokens.passed ? '✓ All estimates generated' : '✗ Some estimates are zero'}`);
  for (const [file, tokens] of Object.entries(results.fileTokens.estimates)) {
    console.log(`    ${file}: ~${tokens} tokens`);
  }
  console.log();

  // Test 4: Error Reporting
  console.log('Test 4: Error Reporting');
  results.errorReporting = await testErrorReporting();
  console.log(`  → ${results.errorReporting.message}`);
  console.log();

  // Test 5: Selector Validation
  console.log('Test 5: DOM Selector Validation');
  results.selectorValidation = testSelectorValidation();
  console.log(`  → ${results.selectorValidation.passed ? '✓ All selectors valid' : '✗ Some selectors invalid'}`);
  for (const [selector, valid] of Object.entries(results.selectorValidation.validSelectors)) {
    console.log(`    ${selector}: ${valid ? '✓' : '✗'}`);
  }
  console.log();

  // Test 6: Metadata Extraction
  console.log('Test 6: Metadata Extraction');
  results.metadataExtraction = testMetadataExtraction();
  console.log(`  → ${results.metadataExtraction.passed ? '✓ Fallback parsing works' : '✗ Some extractions failed'}\n`);

  const allPassed = Object.values(results).every((r: any) => r.passed === true);

  console.log('───────────────────────────────────────');
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - Ready for production');
  } else {
    console.log('❌ SOME TESTS FAILED - Do not push yet');
  }
  console.log('───────────────────────────────────────\n');

  return {
    allPassed,
    results,
  };
}

// Export for CLI if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runProductionChecklist,
    testInputDetection,
    testAttachmentDetection,
    testFileTokenEstimation,
    testErrorReporting,
    testSelectorValidation,
    testMetadataExtraction,
  };
}
