/**
 * Turns the setting-details response into what the Account page shows
 * (same rules as the current app, including the HOA sub-user fixes).
 */
import { get, K } from '../../lib/storage';
import { isPresent, firstPresent, formatApiDate } from '../../lib/format';

// "1 month" / "3 months" from a plan's interval + interval_count
function intervalLabel(plan) {
  if (!plan || !isPresent(plan.interval)) return '';
  const count = Number(plan.interval_count) || 1;
  return count + ' ' + plan.interval + (count > 1 ? 's' : '');
}

// HOA sub users share userrole "hoa" with the main user; only the login
// flag (or the API's own flag) tells them apart.
export function isHoaSubUser(data) {
  if (get(K.IS_HOA_SUB_USER) === '1') return true;
  return !!data && data.is_hoa_sub_user === true;
}

export function buildAccountView(data) {
  data = data || {};
  const userinfo = data.userinfo || {};
  const sub = data.subscription || {};
  const plan = data.plan || {};
  const userType = userinfo.user_type || data.user_type || '';

  // setting-details doesn't reliably expose is_custom_user; use login's value
  const lsCustom = get(K.IS_CUSTOM_USER);
  const isCustomUser = lsCustom === '1' || Number(lsCustom) === 1 || get(K.USER_TYPE) === 'custom' || userType === 'custom';

  const planAmount = plan.amount ? ' ($' + (plan.amount / 100).toFixed(2) + ')' : '';
  const stripePlanName = firstPresent([plan.nickname, plan.name]);
  // HOA sub users have no Stripe subscription: the plan lives in the
  // custom-subscription fields / interval instead.
  const customSub = data.custom_subscription || data.custom_plan || {};
  const planDisplay = firstPresent([
    sub.name,
    stripePlanName && stripePlanName + planAmount,
    customSub.name,
    customSub.plan_name,
    sub.plan_type,
    data.plan_name,
    intervalLabel(customSub) || intervalLabel(plan),
  ]) || '—';

  const canceled = !!sub.canceled;
  const rawDate = String(firstPresent([
    sub.renewaldatetime, sub.plan_expired_at, data.renewaldatetime, data.custom_subscription_expired_at,
    customSub.expired_at, customSub.plan_expired_at, customSub.end_date, data.plan_expired_at,
  ]) || '');
  const dateValue = formatApiDate(rawDate) || rawDate || '—';

  const cardDetails = data.card_details || {};
  const cardLast4 = cardDetails.card_last_four || userinfo.card_last_four || 'N/A';

  return {
    userId: userinfo.id || data.user_id || get(K.USER_ID),
    details: [
      ['Name', userinfo.name || '—'],
      ['Email', userinfo.email || '—'],
      ['Passcode', userinfo.passcode || data.passcode || '—'],
      ['Home Timezone', data.timezone || userinfo.timezone || '—'],
      ['Current Timezone', data.timezone || userinfo.timezone || '—'],
      ['Zipcode', data.zipcode || userinfo.zipcode || '—'],
    ],
    canDelete: !isHoaSubUser(data),
    isCustomUser: isCustomUser,
    planDisplay: planDisplay,
    canceled: canceled,
    dateLabel: isCustomUser || canceled ? 'Plan Expiry Date' : 'Plan Renewal Date',
    dateValue: dateValue,
    cardBrand: cardDetails.card_brand || userinfo.card_brand || 'N/A',
    cardNumber: cardLast4 !== 'N/A' ? 'XXXX XXXX XXXX ' + cardLast4 : 'N/A',
  };
}

// setting-details comes as { success, data } or flat
export function unwrapAccount(data) {
  return data && data.success && data.data ? data.data : data;
}
