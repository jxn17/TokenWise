/**
 * TokenWise onboarding wizard — external script required by CSP (no inline scripts).
 */
(function tokenWiseWelcome() {
  'use strict';

  var currentStep = 0;
  var totalSteps = 3;

  var steps = document.querySelectorAll('.step');
  var dots = document.querySelectorAll('.dot');
  var btnBack = document.getElementById('btn-back');
  var btnNext = document.getElementById('btn-next');

  if (!btnBack || !btnNext || steps.length === 0) {
    return;
  }

  function showStep(index) {
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.toggle('active', i === index);
      if (dots[i]) {
        dots[i].classList.toggle('active', i === index);
      }
    }
    btnBack.classList.toggle('hidden', index === 0);
    btnNext.textContent = index === totalSteps - 1 ? 'Get started' : 'Next';
  }

  function finishOnboarding() {
    try {
      chrome.storage.local.set({ onboardingCompleted: true });
    } catch {
      // Non-critical
    }
    window.close();
  }

  btnBack.addEventListener('click', function () {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep);
    }
  });

  btnNext.addEventListener('click', function () {
    if (currentStep < totalSteps - 1) {
      currentStep++;
      showStep(currentStep);
    } else {
      finishOnboarding();
    }
  });

  showStep(0);
})();
