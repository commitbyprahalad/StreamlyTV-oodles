/**
 * Read-only content shared by the guide and settings screens.
 */
import { API } from '../config/api';
import { request } from '../lib/http';
import { getToken } from '../lib/storage';
import { parsePolicyText, splitLines } from '../lib/format';

export const SUPPORT_DEFAULTS = {
  message1: "Our team is available 24/7. We'll do our best to respond to your inquiries as soon as possible.",
  message2: 'Need help or have a question? Our support team is here to assist you.',
  phone: '773727828',
  email: 'Contact1@streamlytv.com',
};

// [{ title, description }] x3 for the onboarding carousel
export function fetchGuideSlides() {
  return request('POST', API.LOGIN_GUIDE, { timeout: 15000 }).then(function (res) {
    const list = res.data && Array.isArray(res.data.data) ? res.data.data : [];
    if (!list.length) throw new Error('No guide data');
    return list.slice(0, 3).map(function (item) {
      return { title: item.title || '', description: item.description || '' };
    });
  });
}

// Plain-text policy -> { title, paragraphs }
function fetchPolicy(url) {
  const token = getToken();
  return request('GET', url, { token: token || undefined, timeout: 15000 }).then(function (res) {
    const text = res.data && typeof res.data.data === 'string' ? res.data.data.trim() : '';
    if (!text) throw new Error('Empty policy');
    return parsePolicyText(text);
  });
}

export function fetchPrivacyPolicy() {
  return fetchPolicy(API.PRIVACY_POLICY);
}

export function fetchTermsOfUse() {
  return fetchPolicy(API.TERMS_OF_USE);
}

// { message1, message2, phone, email, version }
export function fetchSupportInfo() {
  const token = getToken();
  return request('GET', API.SUPPORT, { token: token || undefined, timeout: 10000 }).then(function (res) {
    const result = res.data;
    if (!result || !result.success || !result.data) return SUPPORT_DEFAULTS;
    const lines = splitLines(result.message);
    const data = result.data;
    return {
      message1: lines[0] || SUPPORT_DEFAULTS.message1,
      message2: lines[1] || '',
      phone: data.num1 || data.phone || SUPPORT_DEFAULTS.phone,
      email: data.email || SUPPORT_DEFAULTS.email,
      version: data.version || '',
    };
  }, function () {
    return SUPPORT_DEFAULTS;
  });
}
