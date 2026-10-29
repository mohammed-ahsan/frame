'use strict';

const showcase = document.querySelector('.style-showcase');
const toggleButtons = document.querySelectorAll('.landing-toggle button');

toggleButtons.forEach((button) => button.addEventListener('click', () => {
  showcase.dataset.presentation = button.dataset.presentation;
  toggleButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
}));

document.querySelector('#landing-year').textContent = new Date().getFullYear();

fetch('/api/ui-config')
  .then((response) => response.ok ? response.json() : Promise.reject(new Error('Brand config unavailable')))
  .then((config) => {
    document.querySelectorAll('[data-ui-brand-name]').forEach((element) => { element.textContent = config.brandName; });
    document.querySelector('.nav-instagram-login').setAttribute('aria-label', `Login with ${config.brandName}`);
  })
  .catch(() => {});
