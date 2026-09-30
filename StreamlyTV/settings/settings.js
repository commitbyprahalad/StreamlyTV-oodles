/**
 * StreamlyTV – Settings Module
 * Samsung Tizen Smart TV
 *
 * Features:
 * - Sidebar navigation with TV remote focus
 * - Account page (GET /api/auth/setting-details)
 * - FAQ page (GET /api/auth/faq) with accordion
 * - Device page (GET /api/auth/newconnecteddevice) with remove-device flow
 * - Support, Privacy, Terms pages
 * - Sign Out via custom overlay
 * - Delete Account via OTP overlay (send OTP -> verify OTP -> delete)
 * - Cancel Subscription via password verification overlay -> confirm -> DELETE
 * - Reuses AuthSession, PopupManager, LoadingManager
 */

const Settings = (function () {
  "use strict";

  // ─── Key Codes ──────────────────────────────────────────────────────────
  const KEYS = {
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    ENTER: 13,
    RETURN: 10009,
    EXIT: 10182,
  };

  // ─── State ──────────────────────────────────────────────────────────────
  const state = {
    activePage: "account",
    focusContext: "sidebar", // 'sidebar' | 'content' | 'signout'
    sidebarIndex: 0,
    contentFocusIndex: 0,
    contentFocusables: [],
    autoFocusPending: false,
    isPageLoading: false,
    faqExpandedIndex: -1,
    caching: {
      account: null,
      faq: null,
      support: null,
      supportMessage: "",
      device: null,
    },
    jwt: localStorage.getItem("jwt token"),
    isSignOutOpen: false,
    signOutFocusIndex: 0,

    // Delete Account OTP overlay state
    isDeleteOtpOpen: false,
    deleteOtpTimer: null,
    deleteOtpSecondsLeft: 0,

    // Resume Subscription OTP overlay state
    isResumeSubOtpOpen: false,
    resumeSubOtpTimer: null,
    resumeSubOtpSecondsLeft: 0,

    // Cancel Subscription password overlay state
    isCancelSubPasswordOpen: false,
    cancelSubFocusIndex: 0,

    isCustomUser: false,
    userId: null,
  };

  // ─── Menu Items ─────────────────────────────────────────────────────────
  const MENU_ITEMS = [
    {
      page: "account",
      label: "Account",
      image: "../images/settings/user-03.png",
      title: "Account Settings",
    },
    {
      page: "device",
      label: "Devices",
      image: "../images/settings/devices.png",
      title: "Connected Devices",
    },
    {
      page: "support",
      label: "Support",
      image: "../images/settings/24-support.svg",
      title: "Support",
    },
    {
      page: "privacy",
      label: "Privacy and Policy",
      image: "../images/settings/file-05.png",
      title: "Privacy and Policy",
    },
    {
      page: "terms",
      label: "Terms of Use",
      image: "../images/settings/terms.svg",
      title: "Terms of Use",
    },
    {
      page: "faq",
      label: "FAQ",
      image: "../images/settings/annotation-question.svg",
      title: "FAQ",
    },
    {
      page: "signout",
      label: "Sign Out",
      image: "../images/settings/log-out-01.png",
      title: "Sign Out",
    },
  ];

  // ─── DOM Cache ──────────────────────────────────────────────────────────
  const dom = {};

  function cacheDom() {
    dom.container = document.getElementById("settings-container");
    dom.sidebar = document.getElementById("settings-sidebar");
    dom.backBtn = document.getElementById("sidebar-back");
    dom.menu = document.getElementById("sidebar-menu");
    dom.content = document.getElementById("settings-content");
    dom.pageContainer = document.getElementById("page-container");
    dom.pageTitle = document.getElementById("page-title");
    dom.loading = document.getElementById("loading");
    dom.loadingText = document.getElementById("loading-text");
    dom.signoutOverlay = document.getElementById("signout-overlay");
    dom.signoutBtnNo = document.getElementById("signout-btn-no");
    dom.signoutBtnYes = document.getElementById("signout-btn-yes");

    // Delete Account OTP overlay
    dom.deleteOtpOverlay = document.getElementById("delete-otp-overlay");
    dom.deleteOtpSubtext = document.getElementById("delete-otp-subtext");
    dom.deleteOtpBoxes = document.querySelectorAll(".delete-otp-box");
    dom.deleteOtpError = document.getElementById("delete-otp-error");
    dom.deleteOtpKeypad = document.getElementById("delete-otp-keypad");
    dom.deleteOtpVerifyBtn = document.getElementById("delete-otp-verify-btn");
    dom.deleteOtpResendBtn = document.getElementById("delete-otp-resend-btn");
    dom.deleteOtpTimerText = document.getElementById("delete-otp-timer-text");

    // Resume Subscription OTP overlay
    dom.resumeSubOtpOverlay = document.getElementById("resume-sub-otp-overlay");
    dom.resumeSubOtpSubtext = document.getElementById("resume-sub-otp-subtext");
    dom.resumeSubOtpBoxes = document.querySelectorAll(".resume-otp-box");
    dom.resumeSubOtpError = document.getElementById("resume-sub-otp-error");
    dom.resumeSubOtpKeypad = document.getElementById("resume-sub-otp-keypad");
    dom.resumeSubOtpVerifyBtn = document.getElementById(
      "resume-sub-otp-verify-btn",
    );
    dom.resumeSubOtpResendBtn = document.getElementById(
      "resume-sub-otp-resend-btn",
    );
    dom.resumeSubOtpTimerText = document.getElementById(
      "resume-sub-otp-timer-text",
    );

    // Cancel Subscription password overlay
    dom.cancelSubOverlay = document.getElementById(
      "cancel-sub-password-overlay",
    );
    dom.cancelSubInput = document.getElementById("cancel-sub-password-input");
    dom.cancelSubError = document.getElementById("cancel-sub-password-error");
    dom.cancelSubCancelBtn = document.getElementById(
      "cancel-sub-password-cancel-btn",
    );
    dom.cancelSubSubmitBtn = document.getElementById(
      "cancel-sub-password-submit-btn",
    );
  }

  // ─── Loading ────────────────────────────────────────────────────────────
  // message: what's happening ("Sending OTP...", "Removing device..."),
  // defaults to "Loading..." for page data.
  function showLoading(message) {
    if (dom.loadingText) dom.loadingText.textContent = message || "Loading...";
    if (dom.loading) dom.loading.classList.remove("hidden");
  }

  function hideLoading() {
    if (dom.loading) dom.loading.classList.add("hidden");
  }

  function isLoadingVisible() {
    return !!(dom.loading && !dom.loading.classList.contains("hidden"));
  }

  // ─── Utility ────────────────────────────────────────────────────────────
  function sanitize(val) {
    if (val === null || val === undefined) return "";
    return String(val).replace(/[<>"'`]/g, "");
  }

  // Same "time ago" helper used on the connected-devices screen (device.js)
  function timeAgo(dateString) {
    if (!dateString) return "N/A";
    const now = new Date();
    const past = new Date(dateString.replace(" ", "T"));
    const diffInSeconds = Math.floor((now - past) / 1000);
    const seconds = diffInSeconds % 60;
    const minutes = Math.floor(diffInSeconds / 60) % 60;
    const hours = Math.floor(diffInSeconds / 3600) % 24;
    const days = Math.floor(diffInSeconds / 86400);
    if (days > 0) return days + " day" + (days > 1 ? "s" : "") + " ago";
    if (hours > 0) return hours + " hour" + (hours > 1 ? "s" : "") + " ago";
    if (minutes > 0)
      return minutes + " minute" + (minutes > 1 ? "s" : "") + " ago";
    return seconds + " second" + (seconds > 1 ? "s" : "") + " ago";
  }

  // Same personal-device-name helper used on the connected-devices screen (device.js)
  function getPersonalDeviceName(device) {
    const name = device.personaldevicename;
    if (name === null || name === undefined || name === "") {
      return "NA";
    }
    return name;
  }

  // ─── API Helper ─────────────────────────────────────────────────────────
  function apiRequest(method, url, body, callback) {
    const jwt = state.jwt;
    if (!jwt) {
      console.warn("Settings: No JWT token");
      if (callback) callback(null);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader("Authorization", "Bearer " + jwt);
    xhr.setRequestHeader("Accept", "application/json");
    if (body && !(body instanceof FormData)) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    xhr.timeout = 15000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        hideLoading();
        state.isPageLoading = false;

        if (xhr.status === 401) {
          if (typeof AuthSession !== "undefined") {
            AuthSession.handleSessionExpired();
          }
          if (callback) callback(null);
          return;
        }

        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (
              typeof AuthSession !== "undefined" &&
              AuthSession.checkApiResponse
            ) {
              if (AuthSession.checkApiResponse(data)) {
                if (callback) callback(null);
                return;
              }
            }
            if (callback) callback(data);
          } catch (e) {
            console.error("Settings: JSON parse error", e);
            if (callback) callback(null);
          }
        } else {
          console.error("Settings: HTTP error", xhr.status);
          if (callback) callback(null);
        }
      }
    };

    xhr.onerror = function () {
      hideLoading();
      state.isPageLoading = false;
      if (callback) callback(null);
    };

    xhr.ontimeout = function () {
      hideLoading();
      state.isPageLoading = false;
      if (callback) callback(null);
    };

    try {
      // FormData must be sent as-is (browser sets the multipart boundary);
      // everything else keeps the existing JSON-string behavior.
      xhr.send(
        body
          ? typeof body === "string" || body instanceof FormData
            ? body
            : JSON.stringify(body)
          : null,
      );
    } catch (e) {
      hideLoading();
      state.isPageLoading = false;
      if (callback) callback(null);
    }
  }

  // OTP-specific variant of apiRequest. The shared apiRequest() above
  // discards the response body on any non-200 status, which is correct
  // for most pages (a failed fetch just means "show a failure state").
  // But OTP endpoints (and other verification endpoints, e.g. password
  // verification) return meaningful, user-facing detail in the body
  // even on error statuses like 422 (e.g. "OTP limit reached for
  // today" / "Incorrect password") — so this variant parses and forwards
  // the body on *any* status (except 401, which still goes through the
  // normal session-expired handling), letting callers inspect
  // data.message / data.response_code.
  function apiRequestOtp(method, url, body, callback, suppressAuthRedirect) {
    const jwt = state.jwt;
    if (!jwt) {
      console.warn("Settings: No JWT token");
      if (callback) callback(null);
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader("Authorization", "Bearer " + jwt);
    xhr.setRequestHeader("Accept", "application/json");
    if (body && !(body instanceof FormData)) {
      xhr.setRequestHeader("Content-Type", "application/json");
    }
    xhr.timeout = 15000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        hideLoading();
        state.isPageLoading = false;

        if (xhr.status === 401 && !suppressAuthRedirect) {
          if (typeof AuthSession !== "undefined") {
            AuthSession.handleSessionExpired();
          }
          if (callback) callback(null);
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText);
          if (
            typeof AuthSession !== "undefined" &&
            AuthSession.checkApiResponse
          ) {
            if (AuthSession.checkApiResponse(data)) {
              if (callback) callback(null);
              return;
            }
          }
          if (callback) callback(data);
        } catch (e) {
          console.error("Settings: JSON parse error", e);
          if (callback) callback(null);
        }
      }
    };

    xhr.onerror = function () {
      hideLoading();
      state.isPageLoading = false;
      if (callback) callback(null);
    };

    xhr.ontimeout = function () {
      hideLoading();
      state.isPageLoading = false;
      if (callback) callback(null);
    };

    try {
      xhr.send(
        body
          ? typeof body === "string" || body instanceof FormData
            ? body
            : JSON.stringify(body)
          : null,
      );
    } catch (e) {
      hideLoading();
      state.isPageLoading = false;
      if (callback) callback(null);
    }
  }

  // ─── Sidebar Rendering ──────────────────────────────────────────────────
  function renderSidebar() {
    let html = "";
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      const item = MENU_ITEMS[i];
      const isActive = item.page === state.activePage;
      const isSignOut = item.page === "signout";
      html +=
        '<div class="menu-item' +
        (isActive ? " active" : "") +
        (isSignOut ? " signout-item" : "") +
        '" data-page="' +
        item.page +
        '" data-index="' +
        i +
        '" tabindex="0">' +
        '<img src="' +
        item.image +
        '" alt="' +
        item.title +
        '" class="menu-icon">' +
        '<span class="menu-label">' +
        item.label +
        "</span>" +
        "</div>";
    }
    dom.menu.innerHTML = html;
  }

  // ─── Page Routing ───────────────────────────────────────────────────────
  function navigateTo(page) {
    if (page === state.activePage) {
      focusContentArea();
      return;
    }

    if (page === "signout") {
      openSignOutOverlay();
      return;
    }

    state.activePage = page;
    state.contentFocusIndex = 0;
    state.contentFocusables = [];
    state.faqExpandedIndex = -1;
    // The new page takes focus once its content loads, unless the user
    // moves back into the sidebar before then (see autoFocusContent()).
    state.autoFocusPending = true;

    // Update sidebar active state
    const menuItems = dom.menu.querySelectorAll(".menu-item");
    for (let i = 0; i < menuItems.length; i++) {
      menuItems[i].classList.remove("active");
      if (menuItems[i].getAttribute("data-page") === page) {
        menuItems[i].classList.add("active");
      }
    }

    // Update page title
    const item = MENU_ITEMS.filter(function (m) {
      return m.page === page;
    })[0];
    if (item && dom.pageTitle) {
      dom.pageTitle.textContent = item.title;
    }

    renderPage(page);
  }

  function renderPage(page) {
    dom.pageContainer.innerHTML = "";
    dom.pageContainer.scrollTop = 0;
    // Long text pages show a right-side scrollbar so the user can see how
    // far through the document they are (hidden on every other page).
    dom.pageContainer.classList.toggle(
      "scrollbar-primary",
      page === "privacy" || page === "terms",
    );

    switch (page) {
      case "account":
        renderAccountPage();
        break;
      case "device":
        renderDevicePage();
        break;
      case "support":
        renderSupportPage();
        break;
      case "privacy":
        renderPrivacyPage();
        break;
      case "terms":
        renderTermsPage();
        break;
      case "faq":
        renderFaqPage();
        break;
      default:
        renderAccountPage();
    }
  }

  // ─── Account Page ───────────────────────────────────────────────────────
  function renderAccountPage() {
    dom.pageContainer.innerHTML =
      // Account Details
      '<div class="account-details-section content-focusable" id="account-details-section" tabindex="0">' +
      '<div class="section-title">Account Details</div>' +
      '<div class="account-details-grid" id="account-details-grid">' +
      '<div class="account-detail-item"><div class="detail-label">Loading...</div><div class="detail-value">Please wait</div></div>' +
      "</div>" +
      '<button class="delete-account-btn" id="delete-account-btn" tabindex="-1">Delete Account</button>' +
      "</div>" +
      // Subscription
      '<div class="subscription-section content-focusable" id="subscription-section" tabindex="0">' +
      '<div class="section-title">Subscription</div>' +
      '<div class="subscription-card" id="sub-card"><div class="sub-value">Loading...</div></div>' +
      "</div>" +
      // Card Details
      '<div class="card-details-section content-focusable" id="card-details-section" tabindex="0">' +
      '<div class="section-title">Card Details</div>' +
      '<div class="card-details-card" id="card-details-card"><div class="card-value">Loading...</div></div>' +
      "</div>";

    fetchAccountData();
  }

  function fetchAccountData() {
    if (state.caching.account) {
      populateAccountData(state.caching.account);
      return;
    }

    showLoading();
    state.isPageLoading = true;

    apiRequest(
      "GET",
      API.SETTING_DETAILS,
      null,
      function (data) {
        if (data) {
          // Handle both { success: true, data: {...} } and flat response formats
          const accountData = data.success && data.data ? data.data : data;
          state.caching.account = accountData;
          populateAccountData(accountData);
        } else {
          const grid = document.getElementById("account-details-grid");
          if (grid) {
            grid.innerHTML =
              '<div class="account-detail-item"><div class="detail-label">Status</div><div class="detail-value">Failed to load account data</div></div>';
          }
          setTimeout(function () {
            autoFocusContent();
          }, 100);
        }
      },
    );
  }

  // Dedicated refresh used after a Cancel/Resume action completes: always
  // hits the API fresh (bypasses the cache), then updates only the
  // Subscription and Card Details cards from the response. The UI is
  // always driven by this freshly-fetched data — canceled/plan/expiry
  // state is never set manually on success.
  function fetchSubscriptionDetails(callback) {
    showLoading("Updating subscription...");

    apiRequest(
      "GET",
      API.SETTING_DETAILS,
      null,
      function (data) {
        if (data) {
          const accountData = data.success && data.data ? data.data : data;
          state.caching.account = accountData;
          updateSubscriptionCard(accountData);
          updateCardDetails(accountData);
          if (callback) callback(accountData);
        } else {
          PopupManager.showAlert("Failed to refresh subscription details.");
          if (callback) callback(null);
        }
      },
    );
  }

  function populateAccountData(data) {
    // ─── Extract values from actual API response structure ─────
    // data.userinfo contains user details
    // data.subscription contains the live subscription record
    //   (renewaldatetime / plan_expired_at, payment_method, canceled)
    // data.plan contains the Stripe price/plan object (nickname, amount)
    // data.card_details contains { card_brand, card_last_four }
    // data.invoices contains invoice list
    // data.timezone, data.zipcode are top-level fields

    const userinfo = data.userinfo || {};

    // Track the account's user id so the Cancel Subscription flow's
    // DELETE call has the account context it needs.
    state.userId = userinfo.id || data.user_id || state.userId;

    const userName = userinfo.name || "—";
    const userEmail = userinfo.email || "—";
    const passcode = userinfo.passcode || data.passcode || "—";
    const homeTimezone = data.timezone || userinfo.timezone || "—";
    const currentTimezone = data.timezone || userinfo.timezone || "—";
    const zipcode = data.zipcode || userinfo.zipcode || "—";

    // ─── Account Details (row content only — the section div itself,
    // rendered in renderAccountPage, is the focusable unit) ─────
    const grid = document.getElementById("account-details-grid");
    if (grid) {
      grid.innerHTML =
        '<div class="account-detail-item">' +
        '<div class="detail-label">Name</div><div class="detail-value">' +
        sanitize(userName) +
        "</div></div>" +
        '<div class="account-detail-item">' +
        '<div class="detail-label">Email</div><div class="detail-value">' +
        sanitize(userEmail) +
        "</div></div>" +
        '<div class="account-detail-item">' +
        '<div class="detail-label">Passcode</div><div class="detail-value">' +
        sanitize(passcode) +
        "</div></div>" +
        '<div class="account-detail-item">' +
        '<div class="detail-label">Home Timezone</div><div class="detail-value">' +
        sanitize(homeTimezone) +
        "</div></div>" +
        '<div class="account-detail-item">' +
        '<div class="detail-label">Current Timezone</div><div class="detail-value">' +
        sanitize(currentTimezone) +
        "</div></div>" +
        '<div class="account-detail-item">' +
        '<div class="detail-label">Zipcode</div><div class="detail-value">' +
        sanitize(zipcode) +
        "</div></div>";
    }

    updateSubscriptionCard(data);
    updateCardDetails(data);

    // After data is populated, focus first content element
    setTimeout(function () {
      autoFocusContent();
    }, 100);
  }

  // ─── Subscription Detail card ──────────────────────────────────────────
  // Driven entirely by subscription.canceled from the latest API response:
  //   Non-Custom + canceled:false -> "Cancel Subscription"  + "Plan Renewal Date"
  //   Non-Custom + canceled:true  -> "Resume Subscription"  + "Plan Expiry Date"
  //   Custom user                 -> existing read-only behavior, no button
  // The card/container itself is never focusable — only the action button
  // is (content-focusable is applied to the button, not the section).
  function updateSubscriptionCard(data) {
    const userinfo = data.userinfo || {};
    const subscriptionData = data.subscription || {};
    const planData = data.plan || {};
    const userType = userinfo.user_type || data.user_type || "";

    // The setting-details API doesn't reliably expose is_custom_user, so
    // use what login already stored in localStorage instead.
    const lsCustomUser = localStorage.getItem("s_custom_user");
    const lsUserType = localStorage.getItem("user_type");
    const isCustomUser =
      lsCustomUser === "1" ||
      Number(lsCustomUser) === 1 ||
      lsUserType === "custom" ||
      userType === "custom";
    state.isCustomUser = isCustomUser;

    const subCard = document.getElementById("sub-card");
    const subSection = document.getElementById("subscription-section");
    if (!subCard || !subSection) return;

    subSection.style.display = "";

    // subscription.name (e.g. "Monthly $79.98/1 month") already
    // includes the price, so prefer it; fall back to the Stripe
    // plan nickname/amount if the subscription object is missing.
    const planFallbackAmount = planData.amount
      ? " ($" + (planData.amount / 100).toFixed(2) + ")"
      : "";
    const planDisplay =
      subscriptionData.name ||
      (planData.nickname || planData.name || "—") + planFallbackAmount;

    const canceled = !!subscriptionData.canceled;

    // Same underlying date field either way — only the label changes
    // depending on whether the plan is still running (renewal) or has
    // been canceled and is just counting down to expiry.
    let dateValue =
      subscriptionData.renewaldatetime ||
      subscriptionData.plan_expired_at ||
      data.renewaldatetime ||
      "—";
    if (dateValue !== "—" && dateValue.indexOf("-") > 0) {
      const parts = dateValue.split(" ")[0].split("-");
      if (parts.length === 3) {
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        const m = parseInt(parts[1], 10) - 1;
        dateValue = months[m] + " " + parseInt(parts[2], 10) + ", " + parts[0];
      }
    }
    const dateLabel =
      isCustomUser || canceled ? "Plan Expiry Date" : "Plan Renewal Date";

    // Custom (HOA sub-account) users keep the existing read-only
    // behavior: plan info shown, no action button, never focusable.
    const actionBtnHtml = isCustomUser
      ? ""
      : '<div style="grid-column: 1 / -1; margin-top: 4px;">' +
        '<button class="subscription-btn ' +
        (canceled ? "resume-subscription-btn" : "cancel-subscription-btn") +
        '" id="subscription-action-btn" tabindex="-1">' +
        (canceled ? "Resume Subscription" : "Cancel Subscription") +
        "</button>" +
        "</div>";

    subCard.innerHTML =
      '<div class="subscription-field">' +
      '<div class="sub-label">Current Plan</div><div class="sub-value">' +
      sanitize(planDisplay) +
      "</div></div>" +
      '<div class="subscription-field">' +
      '<div class="sub-label">' +
      dateLabel +
      '</div><div class="sub-value">' +
      sanitize(dateValue) +
      "</div></div>" +
      actionBtnHtml;

    // The button is created fresh each render, so its listener/focus
    // registration is (re)attached here rather than once in init().
    const actionBtn = document.getElementById("subscription-action-btn");
    if (actionBtn) {
      actionBtn.addEventListener("click", handleSubscriptionAction);
    }
  }

  // ─── Card Detail card ───────────────────────────────────────────────────
  // Always visible for every user type; never focusable for any user type
  // — no content-focusable class, no tabindex, and intentionally left out
  // of refreshContentFocusables()'s selector list.
  function updateCardDetails(data) {
    const userinfo = data.userinfo || {};
    const cardDetails = data.card_details || {};

    const cardCard = document.getElementById("card-details-card");
    const cardSection = document.getElementById("card-details-section");
    if (!cardCard || !cardSection) return;

    if (state.isCustomUser) {
      cardSection.style.display = "none";
      return;
    }
    cardSection.style.display = "";

    // Card details live in the top-level `card_details` object, not on
    // userinfo — fall back to userinfo only for older API responses
    // that may have put it there.
    const cardBrand = cardDetails.card_brand || userinfo.card_brand || "N/A";
    const cardLastFour =
      cardDetails.card_last_four || userinfo.card_last_four || "N/A";
    const cardDisplay =
      cardLastFour !== "N/A" ? "XXXX XXXX XXXX " + cardLastFour : "N/A";

    cardCard.innerHTML =
      '<div class="card-detail-field">' +
      '<div class="card-label">Card Type</div><div class="card-value">' +
      sanitize(cardBrand) +
      "</div></div>" +
      '<div class="card-detail-field">' +
      '<div class="card-label">Card Number</div><div class="card-value">' +
      sanitize(cardDisplay) +
      "</div></div>";
  }

  // ─── Subscription action router ────────────────────────────────────────
  // Reads canceled straight from the latest cached API response — never
  // from a manually-tracked flag — so it always reflects what the server
  // last reported. Only reachable for Non-Custom users, since the action
  // button is only rendered for them.
  function handleSubscriptionAction() {
    const accountData = state.caching.account || {};
    const subscriptionData = accountData.subscription || {};
    const canceled = !!subscriptionData.canceled;

    if (canceled) {
      handleResumeSubscription();
    } else {
      handleCancelSubscription();
    }
  }

  // ─── FAQ Page ───────────────────────────────────────────────────────────
  function renderFaqPage() {
    dom.pageContainer.innerHTML =
      '<div class="faq-list" id="faq-list"><div class="sub-value">Loading...</div></div>';
    fetchFaqData();
  }

  function fetchFaqData() {
    if (state.caching.faq) {
      populateFaqData(state.caching.faq);
      return;
    }

    showLoading();
    state.isPageLoading = true;

    apiRequest(
      "GET",
      API.FAQ,
      null,
      function (data) {
        if (data) {
          // Handle { status: "success", data: [...] }, { success: true, data: [...] }, and flat formats
          const faqData =
            data.data && (data.success || data.status === "success")
              ? data.data
              : data;
          state.caching.faq = faqData;
          populateFaqData(faqData);
        } else {
          const faqList = document.getElementById("faq-list");
          if (faqList)
            faqList.innerHTML =
              '<div class="sub-value">Failed to load FAQ</div>';
          setTimeout(function () {
            autoFocusContent();
          }, 100);
        }
      },
    );
  }

  function populateFaqData(faqItems) {
    const faqList = document.getElementById("faq-list");
    if (!faqList) return;

    // Handle case where FAQ items might be nested inside a property
    if (!Array.isArray(faqItems)) {
      if (faqItems.faq || faqItems.FAQ || faqItems.questions || faqItems.data) {
        faqItems =
          faqItems.faq || faqItems.FAQ || faqItems.questions || faqItems.data;
      }
    }

    if (!faqItems || !faqItems.length) {
      faqList.innerHTML = '<div class="sub-value">No FAQs available</div>';
      setTimeout(function () {
        autoFocusContent();
      }, 100);
      return;
    }

    let html = "";
    for (let i = 0; i < faqItems.length; i++) {
      const item = faqItems[i];
      const question =
        item.question_key ||
        item.question ||
        item.Question ||
        item.title ||
        "Question";
      const answer =
        item.question_answer ||
        item.answer ||
        item.Answer ||
        item.description ||
        "";
      html +=
        '<div class="faq-item content-focusable" tabindex="0" data-index="' +
        i +
        '">' +
        '<div class="faq-question">' +
        "<span>" +
        sanitize(question) +
        "</span>" +
        '<i class="fas fa-chevron-down faq-arrow"></i>' +
        "</div>" +
        '<div class="faq-answer">' +
        '<div class="faq-answer-inner">' +
        sanitize(answer) +
        "</div>" +
        "</div>" +
        "</div>";
    }
    faqList.innerHTML = html;

    setTimeout(function () {
      autoFocusContent();
    }, 100);
  }

  function toggleFaq(index) {
    const items = dom.pageContainer.querySelectorAll(".faq-item");
    if (index < 0 || index >= items.length) return;

    const item = items[index];
    const isExpanded = item.classList.contains("expanded");

    // Collapse all
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove("expanded");
    }

    // Toggle clicked
    if (!isExpanded) {
      item.classList.add("expanded");
      state.faqExpandedIndex = index;
    } else {
      state.faqExpandedIndex = -1;
    }
  }

  // ─── Device Page ────────────────────────────────────────────────────────
  // Mirrors the device-list rendering used on the standalone "connected
  // devices" screen (device.js): same card layout, same helpers
  // (timeAgo / getPersonalDeviceName), same "logout device" flow — just
  // wired into the settings sidebar instead of its own page.
  function renderDevicePage() {
    dom.pageContainer.innerHTML =
      '<div class="device-page-header">' +
      '<div class="device-count">Devices <span id="device-count-value">Loading...</span></div>' +
      "</div>" +
      '<div class="device-grid" id="device-grid">' +
      '<div class="sub-value">Loading devices...</div>' +
      "</div>";

    fetchDeviceData();
  }

  function fetchDeviceData() {
    if (state.caching.device) {
      populateDeviceData(state.caching.device);
      return;
    }

    showLoading();
    state.isPageLoading = true;

    apiRequest(
      "GET",
      API.NEW_CONNECTED_DEVICE,
      null,
      function (data) {
        if (data && data.success) {
          state.caching.device = data;
          populateDeviceData(data);
        } else {
          const grid = document.getElementById("device-grid");
          if (grid)
            grid.innerHTML =
              '<div class="sub-value">Failed to load devices</div>';
          setTimeout(function () {
            autoFocusContent();
          }, 100);
        }
      },
    );
  }

  function populateDeviceData(data) {
    const deviceList = data.data || [];

    // ─── Top count: connected devices / device limit ────────────
    const countEl = document.getElementById("device-count-value");
    if (countEl) {
      const totalCount =
        data.numofdevice !== undefined && data.numofdevice !== null
          ? data.numofdevice
          : deviceList.length;
      const limitCount =
        data.userDeviceLimit !== undefined && data.userDeviceLimit !== null
          ? data.userDeviceLimit
          : "—";
      countEl.textContent = totalCount + " / " + limitCount;
    }

    const grid = document.getElementById("device-grid");
    if (!grid) return;

    if (!deviceList.length) {
      grid.innerHTML = '<div class="sub-value">No devices connected.</div>';
      setTimeout(function () {
        autoFocusContent();
      }, 100);
      return;
    }

    // Current device is identified the same way login/relogin identifies
    // "this" device — the deviceid stored in localStorage.
    const currentDeviceId = localStorage.getItem("deviceid") || "";
    // "This Device" always renders first, regardless of the order the
    // API returns devices in.
    deviceList.sort(function (a, b) {
      const aIsCurrent = !!currentDeviceId && a.device_id === currentDeviceId;
      const bIsCurrent = !!currentDeviceId && b.device_id === currentDeviceId;
      if (aIsCurrent === bIsCurrent) return 0;
      return aIsCurrent ? -1 : 1;
    });
    let html = "";
    for (let i = 0; i < deviceList.length; i++) {
      const device = deviceList[i];
      const isCurrent =
        !!currentDeviceId && device.device_id === currentDeviceId;
      const sessionId = sanitize(device.session_id || "");

      html +=
        '<div class="device-card content-focusable' +
        (isCurrent ? " this-device-card" : "") +
        '" tabindex="0" data-session-id="' +
        sessionId +
        '">' +
        '<div class="device-monitor"><img src="' +
        (device.device_img || "../images/normaltv.png") +
        '" alt="Device"></div>' +
        (isCurrent
          ? '<div class="device-badge"><img src="../images/settings/check-circle.png" alt="This Device">This Device</div>'
          : '<div class="logout-btn-device" data-session-id="' +
            sessionId +
            '" tabindex="-1">Logout Device</div>') +
        '<div class="device-ip">' +
        "<div>IP</div>" +
        "<div>" +
        sanitize(device.user_ip || "N/A") +
        "</div>" +
        "</div>" +
        '<div class="device-info-row">' +
        '<div class="info-line"><strong>Device:</strong> ' +
        sanitize(device.device_name || "Device") +
        "</div>" +
        '<div class="info-line"><strong>Type:</strong> ' +
        sanitize(device.device_type || "N/A") +
        "</div>" +
        '<div class="info-line"><strong>Login:</strong> ' +
        timeAgo(device.logintime) +
        "</div>" +
        '<div class="info-line"><strong>Name:</strong> ' +
        sanitize(getPersonalDeviceName(device)) +
        "</div>" +
        "</div>" +
        "</div>";
    }
    grid.innerHTML = html;

    // Mouse click on the visible "Logout Device" button
    const removeBtns = grid.querySelectorAll(".logout-btn-device");
    for (let b = 0; b < removeBtns.length; b++) {
      removeBtns[b].addEventListener("click", function (e) {
        e.stopPropagation();
        confirmRemoveDevice(this.getAttribute("data-session-id"));
      });
    }

    // Mouse click anywhere else on a non-current card also opens the
    // remove confirmation (matches remote ENTER behaviour below).
    const otherCards = grid.querySelectorAll(
      ".device-card:not(.this-device-card)",
    );
    for (let c = 0; c < otherCards.length; c++) {
      otherCards[c].addEventListener("click", function (e) {
        if (
          e.target &&
          e.target.classList &&
          e.target.classList.contains("logout-btn-device")
        )
          return;
        confirmRemoveDevice(this.getAttribute("data-session-id"));
      });
    }

    setTimeout(function () {
      autoFocusContent();
    }, 100);
  }

  function confirmRemoveDevice(sessionId) {
    if (!sessionId) return;
    PopupManager.showConfirm(
      "Are you sure you want to remove this device?",
      function (confirmed) {
        if (confirmed) {
          removeDevice(sessionId);
        } else {
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
      "Yes",
      "No",
    );
  }

  function removeDevice(sessionId) {
    showLoading("Removing device...");
    state.isPageLoading = true;

    apiRequest(
      "POST",
      API.SAME_DEVICE_ID_LOGOUT,
      { id: sessionId },
      function (data) {
        if (data && data.success) {
          // Invalidate cache so the list (and the count) is fetched fresh
          state.caching.device = null;
          renderDevicePage();
        } else {
          PopupManager.showAlert(
            (data && data.message) || "Failed to remove device.",
          );
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
    );
  }

  // ─── Support Page ───────────────────────────────────────────────────────
  function renderSupportPage() {
    dom.pageContainer.innerHTML =
      '<div class="support-layout">' +
      '<div class="support-illustration"><img src="../images/streamly/help_img.png" alt="help"></div>' +
      '<div class="support-text" id="support-message-1">' +
      "Loading..." +
      "</div>" +
      '<div class="support-text" id="support-message-2" style="font-size:28px;margin-top:0;">' +
      "</div>" +
      '<div class="support-contact-grid">' +
      '<div class="support-contact-card" tabindex="-1">' +
      '<div class="contact-icon"><img src="../images/settings/phone.png" alt="Phone"></div>' +
      '<div class="contact-text">' +
      '<span class="contact-label">Phone</span>' +
      '<span class="contact-value" id="support-phone">Loading...</span>' +
      "</div>" +
      "</div>" +
      '<div class="support-contact-card" tabindex="-1">' +
      '<div class="contact-icon"><img src="../images/settings/mail-01.png" alt="Email"></div>' +
      '<div class="contact-text">' +
      '<span class="contact-label">Email</span>' +
      '<span class="contact-value" id="support-email">Loading...</span>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="support-version" id="support-version">Version: 2.2.3</div>' +
      "</div>";

    fetchSupportInfo();
  }

  function fetchSupportInfo() {
    if (state.caching.support) {
      populateSupportData(state.caching.support);
      return;
    }

    const jwt = state.jwt;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", API.SUPPORT, true);
    if (jwt) xhr.setRequestHeader("Authorization", "Bearer " + jwt);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = 10000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (result && result.success && result.data) {
              state.caching.support = result.data;
              state.caching.supportMessage = result.message || "";
              populateSupportData(result.data, result.message || "");
            } else {
              setSupportDefaults();
            }
          } catch (e) {
            setSupportDefaults();
          }
        } else {
          setSupportDefaults();
        }
        setTimeout(function () {
          autoFocusContent();
        }, 100);
      }
    };

    xhr.onerror = function () {
      setSupportDefaults();
      setTimeout(function () {
        autoFocusContent();
      }, 100);
    };
    xhr.ontimeout = function () {
      setSupportDefaults();
      setTimeout(function () {
        autoFocusContent();
      }, 100);
    };

    try {
      xhr.send();
    } catch (e) {
      setSupportDefaults();
      setTimeout(function () {
        autoFocusContent();
      }, 100);
    }
  }

  function setSupportDefaults() {
    const msg1 = document.getElementById("support-message-1");
    const msg2 = document.getElementById("support-message-2");
    const phone = document.getElementById("support-phone");
    const email = document.getElementById("support-email");

    if (msg1)
      msg1.innerHTML =
        "Our team is available 24/7. We'll do our best to respond to your inquiries as soon as possible.";
    if (msg2)
      msg2.innerHTML =
        "Need help or have a question? Our support team is here to assist you.";
    if (phone) phone.innerHTML = "773727828";
    if (email) email.innerHTML = "Contact1@streamlytv.com";
  }

  function populateSupportData(data, message) {
    const msg1 = document.getElementById("support-message-1");
    const msg2 = document.getElementById("support-message-2");
    const phone = document.getElementById("support-phone");
    const email = document.getElementById("support-email");
    const version = document.getElementById("support-version");

    // Split message into lines (same as guide.js pattern)
    if (message) {
      const lines = message
        .split("\n")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      if (lines[0] && msg1) msg1.innerHTML = sanitize(lines[0]);
      if (lines[1] && msg2) msg2.innerHTML = sanitize(lines[1]);
    } else {
      if (msg1)
        msg1.innerHTML =
          "Our team is available 24/7. We'll do our best to respond to your inquiries as soon as possible.";
    }

    if (phone)
      phone.innerHTML = sanitize(data.num1 || data.phone || "773727828");
    if (email)
      email.innerHTML = sanitize(data.email || "Contact1@streamlytv.com");
    if (version)
      version.innerHTML = "Version " + sanitize(data.version || "2.2.4");
  }

  // ─── Privacy Page ───────────────────────────────────────────────────────
  function renderPrivacyPage() {
    dom.pageContainer.innerHTML =
      '<div class="privacy-title">Privacy &amp; Policy</div>' +
      '<div class="privacy-content">' +
      '<p>STREAMLY is committed to respecting the privacy of our users. We strive to provide a safe, secure user experience. We have adopted this privacy policy ("Privacy Policy") to explain what information may be collected through our Internet Service, how we use this information, and under what circumstances we may disclose the information to third parties. This Privacy Policy only applies to information we collect through our Service and does not apply to our collection of information from other sources.</p>' +
      "<p>This Privacy Policy, together with the Authorized Use Policy and Terms &amp; Conditions of Service posted on our website, sets forth the general rules and policies governing your use of our Service. When you use our Service you agree to this Privacy Policy and other listed policies. Information We May Gather About You will be stored and processed in the United States. The information we gather at STREAMLY will not be shared with third parties unless necessary to make improvements to our products and services using consultants and vendors who will be contractually obligated to not further share this information.</p>" +
      "<p>STREAMLY's web-site may contain links to other web-sites over which we have no control. We are not responsible for the privacy policies or practices of other websites to which you choose to link from our sites. We encourage you to review the privacy policies of those other web-sites so that you can understand the privacy of that web-site.</p>" +
      "<p>STREAMLY may request that you provide personal information, including your name, address, e-mail address, telephone number, credit card number, social security number, contact information, billing information and any other information from which your identity is discernible.</p>" +
      "<p>We also gather or may gather certain information about your use of STREAMLY and any related products and services. There is also information about your computer hardware and software that is or may be collected by us. This information can include without limitation your IP address, MAC address(s), browser type, domain names, access times and referring web-site addresses. Our Use of Your Information Except as expressly set forth in the Privacy Policy, STREAMLY DOES NOT disclose your personal information to third parties, or your combined personal and demographic information.</p>" +
      "<p>STREAMLY uses the information we gather from you or when you visit our website, whether personal, demographic, collective, or technical, for operating and improving our service to you and notifying you of the products and services associated with providing you with telecommunications services that we offer.</p>" +
      "<p>STREAMLY may use your contact information to send you e-mail or other communications regarding updates that relate to your Internet or telecommunications service or related products or services. STREAMLY discloses information to companies and individuals we retain to perform functions on our behalf, such as consultants or vendors that help maintain our telephone service. For example, third parties that host our web servers that analyze data or that process credit card payments. These third parties will have access to your personal information as necessary to perform their functions that aid STREAMLY's ability to provide telephone service, but they may not share that information with any other third party.</p>" +
      "<p>STREAMLY discloses information if legally required to do so, if requested to do so by a governmental entity, or if we believe in good faith that such action is necessary to (a) conform to legal requirements or comply with legal process; (b) protect our rights or rights and property of our affiliated companies; (c) prevent a crime or protect national security; or (d) protect the personal safety of users or the public. STREAMLY may disclose and transfer information to a third party who acquires all or a substantial portion of our business, whether such acquisition is by way of merger, consolidation or purchase of all or substantial portion of our assets.</p>" +
      '<p>Other Uses and Information IP Addresses: An IP address is a number that is automatically assigned to your computer whenever you are surfing the Internet. Web servers (computers that "serve up" web pages) automatically identify your computer by its IP address. When visitors request pages from our Websites, our servers typically log their IP addresses. We collect IP addresses for purposes of system administration, to report non-personal aggregate information to others, and to track the use of our Website. IP addresses are considered non-personal information and may also be shared as provided above. We reserve the right to use IP addresses and any personally identifiable information to identify a visitor when we feel it is necessary to enforce compliance with our Website rules or to: (a) fulfill a government request; (b) conform with the requirements of the law or legal process; (c) protect or defend our legal rights or property, our Website, or other users; or (d) in an emergency to protect the health and safety of our Website\'s users or the general public.</p>' +
      '<p>Cookies: "Cookies" are small text files from a website that are stored on your hard drive. These text files make using our Website more convenient by, among other things, saving your passwords and preferences for you. Cookies themselves do not typically contain any personally identifiable information. We may analyze the information derived from these cookies and match this information with data provided by you or another party. If you are concerned about the storage and use of cookies, you may be able to direct your internet browser to notify you and seek approval whenever a cookie is being sent to your hard drive. You may also delete a cookie manually from your hard drive through your internet browser or other programs. Please note, however, that some parts of our Website will not function properly or be available to you if you refuse to accept a cookie or choose to disable the acceptance of cookies.</p>' +
      "<p>Email Communications: If you send us an email with questions or comments, we may use your personally identifiable information to respond to your questions or comments, and we may save your questions or comments for future reference. For security reasons, we do not recommend that you send non-public personal information, such as passwords, social security numbers, or bank account information, to us by email. However, aside from our reply to such an email, it is not our standard practice to send you email unless you request a service or sign up for a feature that involves email communications, it relates to purchases you have made with us (e.g., product updates, customer support, etc.), we are sending you information about our other services, or you consented to being contacted by email for a particular purpose. In certain instances, we may provide you with the option to set your preferences for receiving email communications from us.</p>" +
      "<p>Security Measures: STREAMLY has put in place measures designed to secure your personal information from accident, loss and from unauthorized access, use, alteration or disclosure. However, while we try to protect your personal information, we cannot guarantee or warrant the security of any information you disclose or transmit to us online. We are not responsible for the theft, destruction, or inadvertent disclosure of your personally identifiable information. Other Sites You may use our Service to link or otherwise access third party websites that we do not control or maintain. There may even be links on our website to third party websites. We are not responsible for the privacy practices and policies employed by any third party. You are encouraged to be aware of when you leave STREAMLY's website. We further encourage you to read the privacy statement of all third-party websites before submitting any personally identifiable information at that website. We may offer chat rooms, blogs, message boards, bulletin boards, or similar public forums where you and other users of our websites can communicate. The protections described in this Privacy Policy do not apply when you provide information (including personal information) in connection with your use of these public forums. We may use personally identifiable information and non-personal information about you to identify you with a posting in a public forum. Any information you share in a public forum is public information and may be seen or collected by anyone, including third parties that do not adhere to our Privacy Policy. We are not responsible for events arising from the distribution of any information you choose to publicly post or share through our Websites.</p>" +
      "<p>Changes. If STREAMLY decides to materially change our Privacy Policy, we will post those changes through a prominent notice in the company web-site so that you will always know what information is being gathered and how that information might be used. We encourage you to review the Privacy Policy from time to time to be sure you know what the policy provides. You may review, correct, update or change your member information at any time. STREAMLY's representatives can assist you with that process.</p>" +
      "<p>Contact Us. If at any time, you have questions or concerns about this privacy statement or believe that we have not adhered to this privacy statement, please feel free to contact us via the Contact Us form on the website. STREAMLY's representatives will promptly answer your question and try to resolve your problem.</p>" +
      "</div>";

    setTimeout(function () {
      autoFocusContent();
    }, 100);
  }

  // ─── Terms Page ─────────────────────────────────────────────────────────
  function renderTermsPage() {
    dom.pageContainer.innerHTML =
      '<div class="terms-title">Streamly Terms of Use</div>' +
      '<div class="terms-subtitle">Please read these terms carefully before using our Services</div>' +
      '<div class="terms-content">' +
      "<p>Welcome to STREAMLY! Our goal is to provide you with outstanding television content at a great price. These Terms of Use, together with our Privacy Policy and End User License Agreement (EULA), govern your access to and use of our websites, apps, and other Services. By accessing or using any of our Services, you confirm that you have read and agree to these Terms of Use. If you do not agree, please do not access or use our Services.</p>" +
      "<p><strong>These Terms of Use require mandatory, binding arbitration on an individual basis to resolve disputes, rather than jury trials or class actions, subject to certain exceptions described below.</strong></p>" +
      "<h3>1. Acceptance of Terms of Use</h3>" +
      "<p>Our Services are not intended for children without the involvement of a parent or legal guardian. Users under 13 may not register. Users between 13 and 18 may register only with parental or guardian consent. These Terms of Use govern your relationship with us and may change from time to time; continued use of the Services after changes take effect constitutes your acceptance of the revised terms. Certain content is copyrighted by third parties and is provided for private, personal, non-commercial use only.</p>" +
      "<h3>2. Our Services</h3>" +
      "<p>Your subscription provides access to our software, websites, and content, including video, audio, and interactive programming. You are responsible for obtaining and maintaining your own internet connection and compatible device, and STREAMLY makes no guarantees about connection speed, quality, or device compatibility. We may add, change, or remove content, packaging, features, or functionality at any time without providing credits or refunds. Certain programming may be blacked out in your area or restricted by age. Our Cloud DVR service, where available, is provided without any guarantee of available recording time, continued access to recordings, or error-free operation, and STREAMLY is released from liability related to its use. You agree to use the Services only in compliance with applicable law and not to circumvent, reverse-engineer, or interfere with the Services in any way. Each account may select only one service offering.</p>" +
      "<h3>3. Membership Accounts</h3>" +
      "<p>To become an Authorized User, you must register for a Membership Account and create login credentials. You are responsible for all activity under your account and for keeping your login credentials confidential. If you believe your account has been accessed without authorization, contact us immediately at 1 (888)-309-0838. We may place your account on hold if we suspect fraudulent or unauthorized activity, without obligation to provide compensation. If your device is lost, stolen, or transferred, notify Customer Service right away to prevent unauthorized access.</p>" +
      "<h3>4. Transactional and Subscription Services</h3>" +
      "<p>Some Services are available without payment (Transactional Services), while others require a paid subscription for a set term (Subscription Services). Subscriptions automatically renew month-to-month at then-current rates unless cancelled. We may offer promotional packages subject to additional terms, and promotional pricing is not guaranteed to continue. Only one promotional offer may apply per Account Owner unless otherwise stated. You may cancel your Subscription Services at any time by visiting our website or calling Customer Service; cancellations are not accepted by email. Because Services are prepaid, cancellation takes effect at the end of the current billing period, and no refunds are issued for partial or unused periods.</p>" +
      "<h3>5. Billing</h3>" +
      "<p>Subscription Services are billed monthly in advance to your registered credit or debit card. We may change fees, add surcharges, or apply interest and late fees for overdue amounts. All payments are non-refundable except as we may elect, at our sole discretion, on a case-by-case basis. If your account is disconnected for non-payment, you may be required to pay all outstanding amounts before Services are restored, and you may lose eligibility for prior promotional pricing. Billing disputes must be reported within 15 days of the applicable bill. Residents of Puerto Rico are billed by streamlytv.com on behalf of DISH Network Puerto Rico L.L.C.</p>" +
      "<h3>6. Customer Support Services and Communications</h3>" +
      "<p>STREAMLY may, at its discretion, provide customer support in connection with your account. By registering, you consent to receive electronic communications from us, including account notices, service updates, and promotional messages. You may opt out of non-transactional communications at any time via the unsubscribe link or by contacting Customer Service.</p>" +
      "<h3>7. Intellectual Property</h3>" +
      '<p>All STREAMLY Services and content are protected by copyright, trademark, and other intellectual property laws. "STREAMLY," "STREAMLY Television," and "STREAMLYTV" are registered trademarks. Your use of our apps and software is also governed by our End User License Agreement (EULA). If you believe your copyrighted work has been infringed, please submit a written notice with the required details to our Notice Address or through our DMCA policy. Unauthorized reception or redistribution of our Services is a violation of federal and state law and may result in significant civil and criminal penalties, including account termination.</p>' +
      "<h3>8. Disclaimer of Warranties</h3>" +
      '<p>Our Services are provided on an "as is" and "as available" basis. Except as expressly stated in these Terms of Use, STREAMLY disclaims all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee uninterrupted, error-free, or secure service, nor do we warrant the performance of any device or internet connection used with our Services. Use of the Services, and any content obtained through them, is at your own risk.</p>' +
      "<h3>9. Limitation of Liability</h3>" +
      "<p>STREAMLY and its affiliates are not liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the Services, even if advised of the possibility of such damages. We are not responsible for failures caused by events beyond our reasonable control (force majeure), including natural disasters, power or technical failures, or governmental action. Except where otherwise stated, our maximum aggregate liability is limited to the fees you paid during the six months preceding a claim. Some jurisdictions do not allow these limitations, in which case they may not fully apply to you.</p>" +
      "<h3>10. Indemnification</h3>" +
      "<p>You agree to indemnify and hold harmless STREAMLY, its affiliates, partners, and related parties from any claims, damages, or expenses, including reasonable attorneys' fees, arising from your use of the Services, your Membership Account, or your violation of these Terms of Use or the rights of another user.</p>" +
      "<h3>11. Dispute Resolution, Arbitration Agreement and Class Action Waiver</h3>" +
      "<p>Except for disputes relating to intellectual property enforcement, you and STREAMLY agree that disputes will be resolved exclusively through individual binding arbitration or small claims court, not through class actions or jury trials. Before initiating arbitration, both parties agree to attempt informal resolution for at least 60 days after a written Dispute Notice is sent. Arbitration will be administered by the American Arbitration Association (AAA) under its Consumer Arbitration Rules. For claims under $75,000, STREAMLY will generally cover arbitration costs and fees. Neither party may bring claims as part of a class, consolidated, or representative proceeding. You may opt out of this arbitration agreement by sending written notice within 30 days of first accepting these Terms of Use. This section does not prevent you from filing complaints with government agencies such as the FCC.</p>" +
      "<h3>12. Miscellaneous</h3>" +
      "<p>Notices may be provided by mail, email, telephone, or through your Membership Account. These Terms of Use, together with the Privacy Policy and EULA, constitute the entire agreement between you and STREAMLY and are governed by the laws of the State of Nevada. Any claims not subject to arbitration must be filed in the state or federal courts of Denver, Colorado. STREAMLY may assign these Terms of Use to a third party without your consent; you may not assign your agreement without our prior written consent. Any claim must be filed within one year of when it arose, or it is permanently waived. Provisions that would reasonably be expected to survive termination of your account, including indemnification, dispute resolution, and limitation of liability, will continue to apply after termination.</p>" +
      "</div>";

    setTimeout(function () {
      autoFocusContent();
    }, 100);
  }

  // ─── Sign Out ───────────────────────────────────────────────────────────
  function openSignOutOverlay() {
    state.isSignOutOpen = true;
    state.focusContext = "signout";
    state.signOutFocusIndex = 0;

    if (dom.signoutOverlay) {
      dom.signoutOverlay.classList.remove("hidden");
      focusSignOutButton(0);
    }
  }

  function closeSignOutOverlay() {
    state.isSignOutOpen = false;
    if (dom.signoutOverlay) {
      dom.signoutOverlay.classList.add("hidden");
    }
    // Return focus to sidebar
    setTimeout(function () {
      state.focusContext = "sidebar";
      focusSidebar();
    }, 50);
  }

  // Back/Return from the Settings screen exits immediately to the EPG
  // guide — no confirmation popup. Replaces the old showExitConfirmation()
  // flow, which asked "Are you sure you want to exit..." before leaving.
  function exitSettings() {
    window.location.href = "../programmeguide/epg.html";
  }

  function focusSignOutButton(index) {
    const buttons = [dom.signoutBtnNo, dom.signoutBtnYes];
    for (let i = 0; i < buttons.length; i++) {
      if (buttons[i]) buttons[i].classList.remove("focused");
    }
    if (index >= 0 && index < buttons.length && buttons[index]) {
      buttons[index].classList.add("focused");
      buttons[index].focus();
      state.signOutFocusIndex = index;
    }
  }

  function handleSignOut() {
    if (dom.signoutOverlay) {
      dom.signoutOverlay.classList.add("hidden");
    }
    state.isSignOutOpen = false;
    showLoading("Signing out...");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", API.LOGOUT, true);
    xhr.setRequestHeader("Authorization", "Bearer " + state.jwt);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        hideLoading();
        localStorage.clear();
        window.location.href = "../guide/guide.html";
      }
    };
    xhr.onerror = function () {
      hideLoading();
      localStorage.clear();
      window.location.href = "../guide/guide.html";
    };
    // Remote keys are blocked while the loader is up, so never wait forever
    xhr.timeout = 15000;
    xhr.ontimeout = xhr.onerror;
    try {
      xhr.send();
    } catch (e) {
      hideLoading();
      localStorage.clear();
      window.location.href = "../guide/guide.html";
    }
  }

  // ─── Shared OTP numeric keypad ──────────────────────────────────────────
  // Both OTP overlays (Delete Account, Resume Subscription) use the same
  // on-screen keypad: digits only, plus Backspace (removes the last digit)
  // and Clear (removes all digits). The 6 boxes are display-only; the box
  // the next digit will land in is highlighted as the cursor.
  //
  // D-pad layout (keypad is 2 rows x 6), then Verify, then Resend:
  //   1 2 3 4 5 6
  //   7 8 9 0 ⌫ Clear
  //      [Verify]
  //      [Resend]
  const OTP_KEYPAD_KEYS = [
    "1", "2", "3", "4", "5", "6",
    "7", "8", "9", "0", "back", "clear",
  ];
  const OTP_KEYPAD_COLS = 6;
  const OTP_BACKSPACE_KEYCODE = 8;
  // Inline SVG rather than the U+232B glyph, which many TV fonts lack.
  const OTP_BACKSPACE_ICON =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" ' +
    'd="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'd="M12 9l6 6M18 9l-6 6"/></svg>';

  // Tizen TV remotes/dial-pads send standard digit key codes for the
  // physical number buttons: 48-57 on the main row, 96-105 on some
  // numeric-keypad-style remotes. Handling these directly (rather than
  // relying on native <input> typing) makes dial-pad entry reliable
  // regardless of how the embedded browser dispatches remote key events.
  function isOtpDigitKey(keyCode) {
    return (
      (keyCode >= 48 && keyCode <= 57) || (keyCode >= 96 && keyCode <= 105)
    );
  }

  function otpDigitFromKeyCode(keyCode) {
    return String(keyCode >= 96 ? keyCode - 96 : keyCode - 48);
  }

  // opts: { boxes, keypad, errorEl, verifyBtn, resendBtn,
  //         onVerify, onResend, onClose }
  function createOtpPad(opts) {
    const boxes = opts.boxes || [];
    const keyEls = [];
    let digits = [];
    let focus = "key-0"; // "key-<n>" | "verify" | "resend"
    let lastKeyIndex = 0;

    if (opts.keypad) {
      opts.keypad.innerHTML = "";
      for (let i = 0; i < OTP_KEYPAD_KEYS.length; i++) {
        (function (index) {
          const key = OTP_KEYPAD_KEYS[index];
          const btn = document.createElement("button");
          btn.className = "otp-key";
          btn.setAttribute("tabindex", "-1");
          if (key === "back") {
            btn.className += " otp-key-action";
            btn.innerHTML = OTP_BACKSPACE_ICON;
            btn.setAttribute("aria-label", "Backspace");
          } else if (key === "clear") {
            btn.className += " otp-key-action";
            btn.textContent = "Clear";
          } else {
            btn.textContent = key;
          }
          btn.addEventListener("click", function () {
            setFocus("key-" + index);
            pressKey(key);
          });
          opts.keypad.appendChild(btn);
          keyEls.push(btn);
        })(i);
      }
    }

    function clearError() {
      if (opts.errorEl) opts.errorEl.textContent = "";
    }

    function render() {
      const cursor = Math.min(digits.length, boxes.length - 1);
      for (let i = 0; i < boxes.length; i++) {
        boxes[i].value = digits[i] || "";
        boxes[i].classList.toggle("filled", !!digits[i]);
        boxes[i].classList.toggle("focused", i === cursor);
      }
    }

    function isResendEnabled() {
      return !!(opts.resendBtn && !opts.resendBtn.disabled);
    }

    function setFocus(target) {
      for (let i = 0; i < keyEls.length; i++) {
        keyEls[i].classList.remove("focused");
      }
      if (opts.verifyBtn) opts.verifyBtn.classList.remove("focused");
      if (opts.resendBtn) opts.resendBtn.classList.remove("focused");

      if (target === "resend" && !isResendEnabled()) target = "verify";
      focus = target;

      let el = null;
      if (target.indexOf("key-") === 0) {
        lastKeyIndex = parseInt(target.slice(4), 10) || 0;
        el = keyEls[lastKeyIndex];
      } else if (target === "verify") {
        el = opts.verifyBtn;
      } else if (target === "resend") {
        el = opts.resendBtn;
      }
      if (el) {
        el.classList.add("focused");
        el.focus();
      }
    }

    function appendDigit(digit) {
      if (digits.length >= boxes.length) return;
      digits.push(digit);
      clearError();
      render();
      // Code complete: jump to Verify so OK submits it straight away.
      if (digits.length === boxes.length) setFocus("verify");
    }

    function backspace() {
      if (!digits.length) return;
      digits.pop();
      clearError();
      render();
    }

    function pressKey(key) {
      if (key === "back") {
        backspace();
      } else if (key === "clear") {
        digits = [];
        clearError();
        render();
      } else {
        appendDigit(key);
      }
    }

    function handleKey(keyCode) {
      if (isOtpDigitKey(keyCode)) {
        appendDigit(otpDigitFromKeyCode(keyCode));
        return;
      }
      if (keyCode === OTP_BACKSPACE_KEYCODE) {
        backspace();
        return;
      }

      const onKey = focus.indexOf("key-") === 0;
      const idx = onKey ? lastKeyIndex : -1;
      const col = idx % OTP_KEYPAD_COLS;

      switch (keyCode) {
        case KEYS.LEFT:
          if (onKey && col > 0) setFocus("key-" + (idx - 1));
          break;
        case KEYS.RIGHT:
          if (
            onKey &&
            col < OTP_KEYPAD_COLS - 1 &&
            idx + 1 < keyEls.length
          ) {
            setFocus("key-" + (idx + 1));
          }
          break;
        case KEYS.UP:
          if (onKey) {
            if (idx - OTP_KEYPAD_COLS >= 0) {
              setFocus("key-" + (idx - OTP_KEYPAD_COLS));
            }
          } else if (focus === "resend") {
            setFocus("verify");
          } else {
            setFocus("key-" + lastKeyIndex);
          }
          break;
        case KEYS.DOWN:
          if (onKey) {
            if (idx + OTP_KEYPAD_COLS < keyEls.length) {
              setFocus("key-" + (idx + OTP_KEYPAD_COLS));
            } else {
              setFocus("verify");
            }
          } else if (focus === "verify" && isResendEnabled()) {
            setFocus("resend");
          }
          break;
        case KEYS.ENTER:
          if (onKey) {
            pressKey(OTP_KEYPAD_KEYS[idx]);
          } else if (focus === "verify") {
            opts.onVerify();
          } else if (focus === "resend") {
            opts.onResend();
          }
          break;
        case KEYS.RETURN:
          opts.onClose();
          break;
      }
    }

    return {
      getValue: function () {
        return digits.join("");
      },
      // Empties the boxes (error text is left alone so an "Invalid OTP"
      // message stays visible while the user re-enters the code).
      reset: function () {
        digits = [];
        render();
      },
      // Puts the cursor back on the first box and focus on the keypad.
      focusStart: function () {
        render();
        setFocus("key-0");
      },
      focusVerify: function () {
        setFocus("verify");
      },
      handleKey: handleKey,
    };
  }

  let deleteOtpPad = null;
  let resumeSubOtpPad = null;

  // ─── Delete Account (OTP flow) ───────────────────────────────────────────
  // Flow: confirm -> POST /account-delete/otp -> OTP overlay ->
  //       POST /account-delete/otp/verify -> POST /user/delete -> logout+redirect

  function startDeleteAccountFlow() {
    PopupManager.showConfirm(
      "Are you sure you want to delete your account?",
      function (confirmed) {
        if (confirmed) {
          sendDeleteAccountOtp();
        } else {
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
      "OK",
      "Cancel",
    );
  }

  // The OTP endpoints don't consistently return a plain `success: true` —
  // some responses use status: "success" or just response_code: 200 with
  // no explicit success flag. Checking success strictly as `data.success`
  // was treating real successes as failures, which popped the generic
  // error alert (showing the API's "OTP sent" message as a standalone
  // popup) instead of opening the Verify OTP screen.
  function isOtpApiSuccess(data) {
    if (!data) return false;
    if (data.success === true || data.success === 1 || data.success === "1")
      return true;
    if (data.status === "success") return true;
    if (data.success !== false && data.response_code === 200) return true;
    return false;
  }

  // Detects the "too many OTP requests" condition so it can be shown as
  // its own dedicated alert instead of falling through to the generic
  // "Something went wrong" message. Checks the exact shape the API is
  // known to return for this case, plus a few common fallback shapes
  // (HTTP-429-style codes, explicit flags, or "limit" wording in the
  // message) in case the backend response varies.
  function isOtpLimitReached(data) {
    if (!data) return false;

    // Exact shape the API returns for this condition:
    // { status: false, response_code: 422, message: "OTP limit reached for today. Try again later ." }
    if (data.response_code === 422 && data.status === false) return true;

    if (data.response_code === 429) return true;
    if (data.status === 429 || data.status === "429") return true;

    const code = (data.error_code || data.code || "").toString().toLowerCase();
    if (
      code.indexOf("otp_limit") !== -1 ||
      code.indexOf("limit_reached") !== -1 ||
      code === "too_many_requests"
    )
      return true;

    if (data.limit_reached === true || data.otp_limit_reached === true)
      return true;

    const msg = (data.message || "").toString().toLowerCase();
    if (
      msg.indexOf("limit") !== -1 &&
      (msg.indexOf("otp") !== -1 ||
        msg.indexOf("attempt") !== -1 ||
        msg.indexOf("request") !== -1)
    ) {
      return true;
    }

    return false;
  }

  function sendDeleteAccountOtp() {
    showLoading("Sending OTP...");
    const formData = new FormData();
    formData.append("action", "delete_account");

    apiRequestOtp(
      "POST",
      API.ACCOUNT_DELETE_OTP,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          // Go straight into the Verify OTP popup — no separate
          // "OTP sent" confirmation in between.
          openDeleteOtpOverlay(data && data.message);
        } else {
          handleDeleteOtpError(data);
        }
      },
    );
  }

  function openDeleteOtpOverlay(message) {
    state.isDeleteOtpOpen = true;
    state.focusContext = "delete-otp";

    clearDeleteOtpBoxes();
    if (dom.deleteOtpError) dom.deleteOtpError.textContent = "";
    if (dom.deleteOtpSubtext) {
      dom.deleteOtpSubtext.textContent =
        message ||
        "OTP sent to your email. Enter it below to delete your account.";
    }
    if (dom.deleteOtpOverlay) dom.deleteOtpOverlay.classList.remove("hidden");

    startDeleteOtpTimer();

    // Move focus into the popup (keypad) and keep it there — nothing
    // in the background page is reachable while isDeleteOtpOpen is true,
    // since handleKeyDown routes every key to deleteOtpPad first.
    setTimeout(function () {
      deleteOtpPad.focusStart();
    }, 50);
  }

  // BACK on an OTP screen (Delete Account / Resume Subscription): ask before
  // abandoning the process. "No" (the default focus, and BACK inside the
  // popup) leaves the OTP screen open with the digits entered so far;
  // PopupManager then returns focus to the OTP pad element that had it.
  function confirmStopOtpProcess(processName, closeOverlay) {
    PopupManager.showConfirm(
      "Are you sure you want to stop the " + processName + " process?",
      function (confirmed) {
        if (confirmed) closeOverlay();
      },
      "Yes",
      "No",
    );
  }

  function closeDeleteOtpOverlay() {
    state.isDeleteOtpOpen = false;
    clearDeleteOtpTimer();

    if (dom.deleteOtpOverlay) dom.deleteOtpOverlay.classList.add("hidden");
    clearDeleteOtpBoxes();
    if (dom.deleteOtpError) dom.deleteOtpError.textContent = "";

    setTimeout(function () {
      state.focusContext = "content";
      focusContentArea();
    }, 50);
  }

  // ── 6-box OTP value helpers (digits live in deleteOtpPad) ──
  function getDeleteOtpValue() {
    return deleteOtpPad ? deleteOtpPad.getValue() : "";
  }

  function clearDeleteOtpBoxes() {
    if (deleteOtpPad) deleteOtpPad.reset();
  }

  // ── Resend timer (60s) ──
  function startDeleteOtpTimer() {
    clearDeleteOtpTimer(); // guard against duplicate intervals on reopen/resend
    state.deleteOtpSecondsLeft = 60;
    updateDeleteOtpTimerUI();
    state.deleteOtpTimer = setInterval(function () {
      state.deleteOtpSecondsLeft--;
      if (state.deleteOtpSecondsLeft <= 0) {
        state.deleteOtpSecondsLeft = 0;
        updateDeleteOtpTimerUI();
        clearDeleteOtpTimer();
      } else {
        updateDeleteOtpTimerUI();
      }
    }, 1000);
  }

  function clearDeleteOtpTimer() {
    if (state.deleteOtpTimer) {
      clearInterval(state.deleteOtpTimer);
      state.deleteOtpTimer = null;
    }
    updateDeleteOtpTimerUI();
  }

  function updateDeleteOtpTimerUI() {
    const seconds = state.deleteOtpSecondsLeft;
    const resendBtn = dom.deleteOtpResendBtn;
    const timerText = dom.deleteOtpTimerText;

    if (seconds > 0) {
      const mm = Math.floor(seconds / 60);
      const ss = seconds % 60;
      const mmStr = (mm < 10 ? "0" : "") + mm;
      const ssStr = (ss < 10 ? "0" : "") + ss;

      if (timerText) {
        timerText.textContent = "Resend code in " + mmStr + ":" + ssStr;
        timerText.classList.remove("hidden");
      }
      if (resendBtn) {
        resendBtn.disabled = true;
        resendBtn.classList.add("disabled");
        resendBtn.classList.add("hidden");
        resendBtn.setAttribute("tabindex", "-1");
        resendBtn.classList.remove("focused");
      }
    } else {
      if (timerText) timerText.classList.add("hidden");
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.classList.remove("disabled");
        resendBtn.classList.remove("hidden");
        resendBtn.textContent = "Resend Now";
        resendBtn.setAttribute("tabindex", "0");
      }
    }
  }

  // ── Resend OTP ──
  function resendDeleteOtp() {
    if (state.deleteOtpSecondsLeft > 0) return; // still within cooldown

    showLoading("Resending OTP...");
    const formData = new FormData();
    formData.append("action", "delete_account");

    apiRequestOtp(
      "POST",
      API.ACCOUNT_DELETE_OTP,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          if (dom.deleteOtpError) dom.deleteOtpError.textContent = "";
          if (dom.deleteOtpSubtext) {
            dom.deleteOtpSubtext.textContent =
              (data && data.message) ||
              "OTP sent to your email. Enter it below to delete your account.";
          }
          clearDeleteOtpBoxes();
          startDeleteOtpTimer();
          deleteOtpPad.focusStart();
        } else {
          handleDeleteOtpError(data);
        }
      },
    );
  }

  // ── Verify OTP ──
  function verifyDeleteOtp() {
    const otp = getDeleteOtpValue();

    if (!/^[0-9]{6}$/.test(otp)) {
      if (dom.deleteOtpError)
        dom.deleteOtpError.textContent = "Please enter the 6-digit OTP.";
      return;
    }
    if (dom.deleteOtpError) dom.deleteOtpError.textContent = "";

    showLoading("Verifying OTP...");
    const formData = new FormData();
    formData.append("otp", otp);
    formData.append("action", "delete_account");

    apiRequestOtp(
      "POST",
      API.ACCOUNT_DELETE_OTP_VERIFY,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          // OTP is confirmed correct — now ask for a final, explicit
          // confirmation before actually deleting anything.
          confirmFinalAccountDeletion();
        } else {
          if (dom.deleteOtpError) {
            dom.deleteOtpError.textContent =
              (data && data.message) ||
              "Invalid or expired OTP. Please try again.";
          }
          // Invalid/expired OTP: clear the entered digits so the user
          // re-enters a fresh code rather than deleting the wrong one.
          clearDeleteOtpBoxes();
          deleteOtpPad.focusStart();
        }
      },
    );
  }

  // ── Final "are you sure" confirm, shown only after OTP verification
  // succeeds — uses the existing PopupManager confirm popup. ──
  function confirmFinalAccountDeletion() {
    PopupManager.showConfirm(
      "Are you sure you want to delete your account? Your subscription will be cancelled and this action cannot be undone.",
      function (confirmed) {
        if (confirmed) {
          finalizeAccountDeletion();
        } else {
          // Stay on the OTP screen so the user can back out cleanly.
          deleteOtpPad.focusVerify();
        }
      },
      "Yes",
      "Cancel",
    );
  }

  // ── Final delete call, then clear the session and send the user to the
  // login screen (account no longer exists, so this bypasses the normal
  // sign-out destination). ──
  function finalizeAccountDeletion() {
    showLoading("Deleting account...");
    apiRequest(
      "POST",
      API.USER_DELETE,
      null,
      function (data) {
        if (isOtpApiSuccess(data)) {
          closeDeleteOtpOverlay();
          localStorage.clear();
          window.location.href = "../login/login.html";
        } else {
          if (dom.deleteOtpError) {
            dom.deleteOtpError.textContent =
              (data && data.message) ||
              "Failed to delete account. Please try again.";
          }
        }
      },
    );
  }

  // ── Shared error handler for OTP send/resend failures. The daily/rate
  // OTP-limit case gets its own clear alert instead of the generic
  // fallback message, so the user understands why they can't request
  // another code and knows to wait out the restriction period. ──
  function handleDeleteOtpError(data) {
    const isLimitReached = isOtpLimitReached(data);
    const msg = isLimitReached
      ? (data && data.message) ||
        "You have reached the maximum number of OTP requests allowed. Please try again after some time."
      : (data && data.message) || "Something went wrong. Please try again.";

    if (state.isDeleteOtpOpen) {
      closeDeleteOtpOverlay();
    }
    PopupManager.showAlert(msg);
  }

  // ─── Resume Subscription (OTP send -> OTP overlay -> verify -> confirm -> resume) ──
  // Flow: Resume Subscription button ->
  //       POST /account/otp-send (action=resume_subscription) -> OTP overlay ->
  //       POST /auth/account/otp-verify (action=resume_subscription, otp) ->
  //       confirm popup (Yes/No) -> Yes -> POST /auth/subscription/resume ->
  //       Loader -> fetchSubscriptionDetails -> update UI

  // ── Step 1: send the OTP, then open the entry overlay ──
  function handleResumeSubscription() {
    showLoading("Sending OTP...");
    const formData = new FormData();
    formData.append("action", "resume_subscription");

    apiRequestOtp(
      "POST",
      API.ACCOUNT_OTP_SEND,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          openResumeSubOtpOverlay(data && data.message);
        } else {
          PopupManager.showAlert(
            (data && data.message) || "Failed to send OTP. Please try again.",
          );
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
    );
  }

  function openResumeSubOtpOverlay(message) {
    state.isResumeSubOtpOpen = true;
    state.focusContext = "resume-sub-otp";

    clearResumeSubOtpBoxes();
    if (dom.resumeSubOtpError) dom.resumeSubOtpError.textContent = "";
    if (dom.resumeSubOtpSubtext) {
      dom.resumeSubOtpSubtext.textContent =
        message ||
        "OTP sent to your email. Enter it below to resume your subscription.";
    }
    if (dom.resumeSubOtpOverlay)
      dom.resumeSubOtpOverlay.classList.remove("hidden");

    startResumeSubOtpTimer();

    // Nothing in the background page is reachable while
    // isResumeSubOtpOpen is true — handleKeyDown routes every key to
    // resumeSubOtpPad first (mirrors the delete-account OTP overlay).
    setTimeout(function () {
      resumeSubOtpPad.focusStart();
    }, 50);
  }

  function closeResumeSubOtpOverlay() {
    state.isResumeSubOtpOpen = false;
    clearResumeSubOtpTimer();

    if (dom.resumeSubOtpOverlay)
      dom.resumeSubOtpOverlay.classList.add("hidden");
    clearResumeSubOtpBoxes();
    if (dom.resumeSubOtpError) dom.resumeSubOtpError.textContent = "";

    setTimeout(function () {
      state.focusContext = "content";
      focusContentArea();
    }, 50);
  }

  // ── 6-box OTP value helpers (mirrors getDeleteOtpValue/clearDeleteOtpBoxes) ──
  function getResumeSubOtpValue() {
    return resumeSubOtpPad ? resumeSubOtpPad.getValue() : "";
  }

  function clearResumeSubOtpBoxes() {
    if (resumeSubOtpPad) resumeSubOtpPad.reset();
  }

  // ── Resend timer (60s) ──
  function startResumeSubOtpTimer() {
    clearResumeSubOtpTimer(); // guard against duplicate intervals on reopen/resend
    state.resumeSubOtpSecondsLeft = 60;
    updateResumeSubOtpTimerUI();
    state.resumeSubOtpTimer = setInterval(function () {
      state.resumeSubOtpSecondsLeft--;
      if (state.resumeSubOtpSecondsLeft <= 0) {
        state.resumeSubOtpSecondsLeft = 0;
        updateResumeSubOtpTimerUI();
        clearResumeSubOtpTimer();
      } else {
        updateResumeSubOtpTimerUI();
      }
    }, 1000);
  }

  function clearResumeSubOtpTimer() {
    if (state.resumeSubOtpTimer) {
      clearInterval(state.resumeSubOtpTimer);
      state.resumeSubOtpTimer = null;
    }
    updateResumeSubOtpTimerUI();
  }

  function updateResumeSubOtpTimerUI() {
    const seconds = state.resumeSubOtpSecondsLeft;
    const resendBtn = dom.resumeSubOtpResendBtn;
    const timerText = dom.resumeSubOtpTimerText;

    if (seconds > 0) {
      const mm = Math.floor(seconds / 60);
      const ss = seconds % 60;
      const mmStr = (mm < 10 ? "0" : "") + mm;
      const ssStr = (ss < 10 ? "0" : "") + ss;

      if (timerText) {
        timerText.textContent = "Resend code in " + mmStr + ":" + ssStr;
        timerText.classList.remove("hidden");
      }
      if (resendBtn) {
        resendBtn.disabled = true;
        resendBtn.classList.add("disabled");
        resendBtn.classList.add("hidden");
        resendBtn.setAttribute("tabindex", "-1");
        resendBtn.classList.remove("focused");
      }
    } else {
      if (timerText) timerText.classList.add("hidden");
      if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.classList.remove("disabled");
        resendBtn.classList.remove("hidden");
        resendBtn.textContent = "Resend Now";
        resendBtn.setAttribute("tabindex", "0");
      }
    }
  }

  // ── Resend OTP (re-hits the same otp-send endpoint) ──
  function resendResumeSubOtp() {
    if (state.resumeSubOtpSecondsLeft > 0) return; // still within cooldown

    showLoading("Resending OTP...");
    const formData = new FormData();
    formData.append("action", "resume_subscription");

    apiRequestOtp(
      "POST",
      API.ACCOUNT_OTP_SEND,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          if (dom.resumeSubOtpError) dom.resumeSubOtpError.textContent = "";
          if (dom.resumeSubOtpSubtext) {
            dom.resumeSubOtpSubtext.textContent =
              (data && data.message) ||
              "OTP sent to your email. Enter it below to resume your subscription.";
          }
          clearResumeSubOtpBoxes();
          startResumeSubOtpTimer();
          resumeSubOtpPad.focusStart();
        } else {
          PopupManager.showAlert(
            (data && data.message) || "Failed to resend OTP. Please try again.",
          );
        }
      },
    );
  }

  // ── Step 2: verify OTP, then ask for final confirmation ──
  function verifyResumeSubOtp() {
    const otp = getResumeSubOtpValue();

    if (!/^[0-9]{6}$/.test(otp)) {
      if (dom.resumeSubOtpError)
        dom.resumeSubOtpError.textContent = "Please enter the 6-digit OTP.";
      return;
    }
    if (dom.resumeSubOtpError) dom.resumeSubOtpError.textContent = "";

    showLoading("Verifying OTP...");
    const formData = new FormData();
    formData.append("action", "resume_subscription");
    formData.append("otp", otp);

    apiRequestOtp(
      "POST",
      API.ACCOUNT_OTP_VERIFY,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          closeResumeSubOtpOverlay();
          setTimeout(function () {
            confirmResumeSubscription();
          }, 100);
        } else {
          if (dom.resumeSubOtpError) {
            dom.resumeSubOtpError.textContent =
              (data && data.message) ||
              "Invalid or expired OTP. Please try again.";
          }
          // Invalid/expired OTP: clear the entered digits so the user
          // re-enters a fresh code rather than editing a wrong one.
          clearResumeSubOtpBoxes();
          resumeSubOtpPad.focusStart();
        }
      },
    );
  }

  // ── Step 2b: final "are you sure" confirmation, shown only after the
  // OTP has been verified — uses the shared PopupManager confirm. ──
  function confirmResumeSubscription() {
    PopupManager.showConfirm(
      "Are you sure you want to resume your subscription?",
      function (confirmed) {
        if (confirmed) {
          callResumeSubscriptionApi();
        } else {
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
      "Yes",
      "No",
    );
  }

  // ── Step 3: POST /auth/subscription/resume, then always refresh from
  // fetchSubscriptionDetails — the UI is never updated by manually
  // flipping a local canceled flag. ──
  function callResumeSubscriptionApi() {
    showLoading("Resuming subscription...");
    apiRequest(
      "POST",
      API.SUBSCRIPTION_RESUME,
      null,
      function (data) {
        if (data && (data.success || isOtpApiSuccess(data))) {
          PopupManager.showAlert(
            (data && data.message) || "Your subscription has been resumed.",
          );
          fetchSubscriptionDetails(function () {
            if (state.activePage === "account") {
              setTimeout(function () {
                focusContentArea();
              }, 100);
            }
          });
        } else {
          PopupManager.showAlert(
            (data && data.message) ||
              "Failed to resume subscription. Please try again.",
          );
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
    );
  }

  // ─── Cancel Subscription (password verify -> confirm -> DELETE) ────────
  // Flow: Cancel Subscription button -> password overlay -> Submit ->
  //       POST /auth/verify-password -> confirm popup (Yes/No) ->
  //       Yes -> DELETE /cancel-subscription/{userId} ->
  //       Loader -> fetchSubscriptionDetails -> update UI

  const CANCEL_SUB_FOCUS_ORDER = ["input", "cancel", "submit"];

  // ── Entry point, called from handleSubscriptionAction() ──
  function handleCancelSubscription() {
    openCancelSubPasswordOverlay();
  }

  function openCancelSubPasswordOverlay() {
    state.isCancelSubPasswordOpen = true;
    state.focusContext = "cancel-sub-password";
    state.cancelSubFocusIndex = 0;

    if (dom.cancelSubInput) dom.cancelSubInput.value = "";
    if (dom.cancelSubError) dom.cancelSubError.textContent = "";
    if (dom.cancelSubOverlay) dom.cancelSubOverlay.classList.remove("hidden");

    // Nothing in the background page is reachable while
    // isCancelSubPasswordOpen is true — handleKeyDown routes every key
    // to handleCancelSubPasswordKeys first (mirrors the OTP overlays).
    setTimeout(function () {
      focusCancelSubTarget("input");
    }, 50);
  }

  function closeCancelSubPasswordOverlay() {
    state.isCancelSubPasswordOpen = false;

    if (dom.cancelSubOverlay) dom.cancelSubOverlay.classList.add("hidden");
    if (dom.cancelSubInput) dom.cancelSubInput.value = "";
    if (dom.cancelSubError) dom.cancelSubError.textContent = "";

    setTimeout(function () {
      state.focusContext = "content";
      focusContentArea();
    }, 50);
  }

  function focusCancelSubTarget(target) {
    if (dom.cancelSubInput) dom.cancelSubInput.classList.remove("focused");
    if (dom.cancelSubCancelBtn)
      dom.cancelSubCancelBtn.classList.remove("focused");
    if (dom.cancelSubSubmitBtn)
      dom.cancelSubSubmitBtn.classList.remove("focused");

    if (target === "input" && dom.cancelSubInput) {
      dom.cancelSubInput.classList.add("focused");
      dom.cancelSubInput.focus();
    } else if (target === "cancel" && dom.cancelSubCancelBtn) {
      dom.cancelSubCancelBtn.classList.add("focused");
      dom.cancelSubCancelBtn.focus();
    } else if (target === "submit" && dom.cancelSubSubmitBtn) {
      dom.cancelSubSubmitBtn.classList.add("focused");
      dom.cancelSubSubmitBtn.focus();
    }
  }

  function handleCancelSubPasswordKeys(keyCode) {
    const current =
      CANCEL_SUB_FOCUS_ORDER[state.cancelSubFocusIndex] || "input";

    switch (keyCode) {
      case KEYS.UP:
        if (current !== "input") {
          state.cancelSubFocusIndex = CANCEL_SUB_FOCUS_ORDER.indexOf("input");
          focusCancelSubTarget("input");
        }
        break;
      case KEYS.DOWN:
        if (current === "input") {
          state.cancelSubFocusIndex = CANCEL_SUB_FOCUS_ORDER.indexOf("submit");
          focusCancelSubTarget("submit");
        }
        break;
      case KEYS.LEFT:
        if (current === "submit") {
          state.cancelSubFocusIndex = CANCEL_SUB_FOCUS_ORDER.indexOf("cancel");
          focusCancelSubTarget("cancel");
        }
        break;
      case KEYS.RIGHT:
        if (current === "cancel") {
          state.cancelSubFocusIndex = CANCEL_SUB_FOCUS_ORDER.indexOf("submit");
          focusCancelSubTarget("submit");
        } else if (current === "input") {
          state.cancelSubFocusIndex = CANCEL_SUB_FOCUS_ORDER.indexOf("submit");
          focusCancelSubTarget("submit");
        }
        break;
      case KEYS.ENTER:
        if (current === "cancel") {
          closeCancelSubPasswordOverlay();
        } else {
          verifySubscriptionCancelPassword();
        }
        break;
      case KEYS.RETURN:
        closeCancelSubPasswordOverlay();
        break;
    }
  }

  // ── Step 1: verify the entered password before allowing cancellation.
  // Validation and API errors are both surfaced inline on the overlay so
  // the user can retry without losing their place. ──
  function verifySubscriptionCancelPassword() {
    const password = dom.cancelSubInput ? dom.cancelSubInput.value : "";

    if (!password) {
      if (dom.cancelSubError)
        dom.cancelSubError.textContent = "Please enter your password.";
      return;
    }
    if (dom.cancelSubError) dom.cancelSubError.textContent = "";

    showLoading("Verifying password...");
    const formData = new FormData();
    formData.append("password", password);

    apiRequestOtp(
      "POST",
      API.VERIFY_PASSWORD,
      formData,
      function (data) {
        if (isOtpApiSuccess(data)) {
          closeCancelSubPasswordOverlay();
          setTimeout(function () {
            confirmCancelSubscription();
          }, 100);
        } else {
          if (dom.cancelSubError) {
            dom.cancelSubError.textContent =
              (data && data.message) || "Incorrect password. Please try again.";
          }
        }
      },
      true,
    );
  }

  // ── Step 1b: final "are you sure" confirmation, shown only after the
  // password has been verified — uses the shared PopupManager confirm. ──
  function confirmCancelSubscription() {
    PopupManager.showConfirm(
      "Are you sure you want to cancel your subscription?",
      function (confirmed) {
        if (confirmed) {
          callCancelSubscriptionApi();
        } else {
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
      "Yes",
      "No",
    );
  }

  // ── Step 2: DELETE /cancel-subscription/{userId}, then always refresh
  // from fetchSubscriptionDetails — the UI is never updated by manually
  // flipping a local canceled flag. ──
  function callCancelSubscriptionApi() {
    if (!state.userId) {
      PopupManager.showAlert(
        "Unable to cancel subscription: missing account information.",
      );
      setTimeout(function () {
        focusContentArea();
      }, 100);
      return;
    }

    showLoading("Cancelling subscription...");
    apiRequest(
      "DELETE",
      API.CANCEL_SUBSCRIPTION + state.userId,
      null,
      function (data) {
        if (data && (data.success || isOtpApiSuccess(data))) {
          PopupManager.showAlert(
            (data && data.message) || "Your subscription has been cancelled.",
          );
          fetchSubscriptionDetails(function () {
            if (state.activePage === "account") {
              setTimeout(function () {
                focusContentArea();
              }, 100);
            }
          });
        } else {
          PopupManager.showAlert(
            (data && data.message) ||
              "Failed to cancel subscription. Please try again.",
          );
          setTimeout(function () {
            focusContentArea();
          }, 100);
        }
      },
    );
  }

  // ─── Scrollable Page Detection ──────────────────────────────────────────
  function isScrollablePage() {
    return state.activePage === "privacy" || state.activePage === "terms";
  }

  function scrollContainer(direction) {
    if (!dom.pageContainer) return;
    const scrollAmount = 60;
    if (direction === "up") {
      dom.pageContainer.scrollTop -= scrollAmount;
    } else {
      dom.pageContainer.scrollTop += scrollAmount;
    }
  }

  function scrollToBottomOfContainer() {
    if (!dom.pageContainer) return;
    dom.pageContainer.scrollTop = dom.pageContainer.scrollHeight;
  }

  // ─── Focus Management ───────────────────────────────────────────────────
  function getSidebarItems() {
    const items = dom.menu.querySelectorAll(".menu-item");
    const allItems = [];
    if (dom.backBtn) {
      allItems.push(dom.backBtn);
    }
    for (let i = 0; i < items.length; i++) {
      allItems.push(items[i]);
    }
    return allItems;
  }

  // Removes every content-side highlight (including the container itself,
  // which scrollable pages mark as focused) so only the region that
  // actually has focus shows a highlight.
  function clearContentFocus() {
    if (!dom.pageContainer) return;
    const allFocusable = dom.pageContainer.querySelectorAll(".focused");
    for (let i = 0; i < allFocusable.length; i++) {
      allFocusable[i].classList.remove("focused");
    }
    dom.pageContainer.classList.remove("focused");
  }

  function focusSidebar() {
    state.focusContext = "sidebar";
    state.autoFocusPending = false;
    // Content keeps contentFocusIndex, so RIGHT restores the same element
    // (and its highlight) when focus actually returns there.
    clearContentFocus();
    const items = getSidebarItems();
    for (let i = 0; i < items.length; i++) {
      items[i].classList.remove("focused");
    }

    // Find the index of the active page
    let activeIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].getAttribute("data-page") === state.activePage) {
        activeIdx = i;
        break;
      }
    }

    const idx = activeIdx >= 0 ? activeIdx : state.sidebarIndex;
    if (idx >= 0 && idx < items.length) {
      state.sidebarIndex = idx;
      items[idx].classList.add("focused");
      items[idx].focus();
      scrollSidebarToItem(idx);
    }
  }

  function scrollSidebarToItem(index) {
    const items = getSidebarItems();
    if (index < 0 || index >= items.length) return;
    const item = items[index];
    if (!item) return;

    const sidebarRect = dom.menu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();

    if (
      itemRect.top < sidebarRect.top ||
      itemRect.bottom > sidebarRect.bottom
    ) {
      item.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  // Returns to the last focused content item (e.g. Subscription, or the
  // same device card) instead of the first one. navigateTo() resets
  // contentFocusIndex to 0 when a different page is opened.
  function focusContentArea() {
    state.focusContext = "content";
    state.autoFocusPending = false;

    // For scrollable text pages (privacy, terms), focus the container itself
    if (isScrollablePage()) {
      clearContentFocus();
      dom.pageContainer.classList.add("focused");
      dom.pageContainer.focus();
      return;
    }

    // Gather all focusable elements in content
    refreshContentFocusables();

    const count = state.contentFocusables.length;
    if (count > 0) {
      // Clamp in case the list shrank (e.g. a device was removed)
      focusContentItem(Math.max(0, Math.min(state.contentFocusIndex, count - 1)));
    }
  }

  // Used once page data has loaded: takes focus only if the user is
  // still in the content area (or just opened the page), so a slow
  // API response never pulls focus out of the sidebar.
  function autoFocusContent() {
    if (state.focusContext === "content" || state.autoFocusPending) {
      focusContentArea();
    }
  }

  // Number of cards per row in the device grid, measured from the
  // rendered layout (cards sharing the first card's top offset).
  function getDeviceGridColumns() {
    const cards = state.contentFocusables;
    if (!cards.length) return 1;
    const firstTop = cards[0].offsetTop;
    let cols = 0;
    while (cols < cards.length && cards[cols].offsetTop === firstTop) {
      cols++;
    }
    return cols || 1;
  }

  function isDeviceGrid() {
    return (
      state.activePage === "device" &&
      state.contentFocusables.length > 0 &&
      state.contentFocusables[0].classList.contains("device-card")
    );
  }

  function focusContentItem(index) {
    clearContentFocus();

    if (index < 0 || index >= state.contentFocusables.length) return;

    const el = state.contentFocusables[index];
    if (!el) return;

    // Card Details (always) and Subscription (for Custom users, who get
    // no action button) are "silent" stops: DOWN/UP can land on them so
    // the page scrolls to reveal them, but no border is shown since
    // there's nothing interactive to do there.
    const isSilentStop =
      el.classList.contains("card-details-section") ||
      (el.classList.contains("subscription-section") && state.isCustomUser);

    if (!isSilentStop) {
      el.classList.add("focused");
    }
    el.focus();
    state.contentFocusIndex = index;

    // Scroll into view
    scrollContentToItem(el);
  }

  function scrollContentToItem(el) {
    if (!el) return;
    const containerRect = dom.pageContainer.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    if (
      elRect.top < containerRect.top ||
      elRect.bottom > containerRect.bottom
    ) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function refreshContentFocusables() {
    state.contentFocusables = [];
    // A single combined selector avoids double-adding elements that
    // match more than one class (e.g. faq-item/device-card also carry
    // .content-focusable) — querySelectorAll never returns the same
    // element twice for one call, unlike running each selector
    // separately and concatenating the results.
    //
    // Note: subscription-section and card-details-section are
    // intentionally NOT included here. Neither container is ever
    // focusable — the Subscription card exposes its own action button
    // (#subscription-action-btn, which carries .content-focusable and
    // is picked up that way, only for Non-Custom users since that's the
    // only case where it's rendered) and the Card Details card has no
    // focusable element at all, for any user type.
    const selector =
      ".content-focusable, .faq-item, .device-card, .account-details-section, .subscription-section";
    const els = dom.pageContainer.querySelectorAll(selector);

    for (let i = 0; i < els.length; i++) {
      // Skip cards/buttons hidden for the current user (display:none)
      // so remote focus never lands on something invisible.
      if (els[i].offsetParent === null) continue;
      state.contentFocusables.push(els[i]);
      if (
        els[i].classList.contains("subscription-section") &&
        state.isCustomUser
      )
        continue;
    }
  }

  // ─── Keyboard Navigation ────────────────────────────────────────────────
  function handleKeyDown(e) {
    const keyCode = e.keyCode;

    // Prevent default for handled keys
    const handledKeys = [
      KEYS.LEFT,
      KEYS.RIGHT,
      KEYS.UP,
      KEYS.DOWN,
      KEYS.ENTER,
      KEYS.RETURN,
      KEYS.EXIT,
    ];
    for (let i = 0; i < handledKeys.length; i++) {
      if (keyCode === handledKeys[i]) {
        if (e.preventDefault) e.preventDefault();
        else e.returnValue = false;
        break;
      }
    }

    // While an OTP overlay (delete-account or renew-subscription) is
    // open, take over the physical number-pad keys ourselves (Tizen
    // dial-pad support) instead of leaving them to native <input>
    // typing, which some embedded TV browsers handle unreliably for
    // remote key presses.
    if (
      (state.isDeleteOtpOpen || state.isResumeSubOtpOpen) &&
      (isOtpDigitKey(keyCode) || keyCode === OTP_BACKSPACE_KEYCODE)
    ) {
      if (e.preventDefault) e.preventDefault();
      else e.returnValue = false;
    }

    // Delegate to PopupManager first if popup is open
    if (typeof PopupManager !== "undefined" && PopupManager.isOpen()) {
      PopupManager.handleKey(keyCode);
      return;
    }

    // An API call is in progress: ignore remote keys so OK can't fire the
    // same request twice (e.g. Verify OTP, Remove device).
    if (isLoadingVisible()) {
      if (e.preventDefault) e.preventDefault();
      return;
    }

    // Handle sign out overlay navigation
    if (state.isSignOutOpen) {
      handleSignOutKeys(keyCode);
      return;
    }

    // Handle delete-account OTP overlay navigation
    if (state.isDeleteOtpOpen) {
      deleteOtpPad.handleKey(keyCode);
      return;
    }

    // Handle resume-subscription OTP overlay navigation
    if (state.isResumeSubOtpOpen) {
      resumeSubOtpPad.handleKey(keyCode);
      return;
    }

    // Handle cancel-subscription password overlay navigation
    if (state.isCancelSubPasswordOpen) {
      handleCancelSubPasswordKeys(keyCode);
      return;
    }

    switch (keyCode) {
      case KEYS.UP:
        handleUp();
        break;
      case KEYS.DOWN:
        handleDown();
        break;
      case KEYS.LEFT:
        handleLeft();
        break;
      case KEYS.RIGHT:
        handleRight();
        break;
      case KEYS.ENTER:
        handleEnter();
        break;
      case KEYS.RETURN:
        handleBack();
        break;
      case KEYS.EXIT:
        handleExit();
        break;
    }
  }

  function handleSignOutKeys(keyCode) {
    const buttons = [dom.signoutBtnNo, dom.signoutBtnYes];
    switch (keyCode) {
      case KEYS.LEFT:
        if (state.signOutFocusIndex > 0) {
          focusSignOutButton(state.signOutFocusIndex - 1);
        }
        break;
      case KEYS.RIGHT:
        if (state.signOutFocusIndex < buttons.length - 1) {
          focusSignOutButton(state.signOutFocusIndex + 1);
        }
        break;
      case KEYS.ENTER:
        if (state.signOutFocusIndex === 0) {
          closeSignOutOverlay();
        } else {
          handleSignOut();
        }
        break;
      case KEYS.RETURN:
        closeSignOutOverlay();
        break;
    }
  }

  function handleUp() {
    if (state.focusContext === "sidebar") {
      state.autoFocusPending = false;
      const items = getSidebarItems();
      if (state.sidebarIndex > 0) {
        items[state.sidebarIndex].classList.remove("focused");
        state.sidebarIndex--;
        items[state.sidebarIndex].classList.add("focused");
        items[state.sidebarIndex].focus();
        scrollSidebarToItem(state.sidebarIndex);
      }
    } else if (state.focusContext === "content") {
      // Scrollable pages (privacy, terms) - scroll up
      if (isScrollablePage()) {
        scrollContainer("up");
      } else if (isDeviceGrid()) {
        const prevRow = state.contentFocusIndex - getDeviceGridColumns();
        if (prevRow >= 0) focusContentItem(prevRow);
      } else if (state.contentFocusIndex > 0) {
        focusContentItem(state.contentFocusIndex - 1);
      }
    }
  }

  function handleDown() {
    if (state.focusContext === "sidebar") {
      state.autoFocusPending = false;
      const items = getSidebarItems();
      if (state.sidebarIndex < items.length - 1) {
        items[state.sidebarIndex].classList.remove("focused");
        state.sidebarIndex++;
        items[state.sidebarIndex].classList.add("focused");
        items[state.sidebarIndex].focus();
        scrollSidebarToItem(state.sidebarIndex);
      }
    } else if (state.focusContext === "content") {
      // Scrollable pages (privacy, terms) - scroll down
      if (isScrollablePage()) {
        scrollContainer("down");
      } else if (isDeviceGrid()) {
        const cols = getDeviceGridColumns();
        const count = state.contentFocusables.length;
        const i = state.contentFocusIndex;
        if (i + cols < count) {
          focusContentItem(i + cols);
        } else if (Math.floor(i / cols) < Math.floor((count - 1) / cols)) {
          // Shorter last row: land on its last card
          focusContentItem(count - 1);
        }
      } else if (state.contentFocusIndex < state.contentFocusables.length - 1) {
        focusContentItem(state.contentFocusIndex + 1);
      }
    }
  }

  function handleLeft() {
    if (state.focusContext !== "content") return;

    // Device grid: move within the row; only the first card of a row
    // (e.g. "This Device") hands focus back to the sidebar.
    if (isDeviceGrid()) {
      const i = state.contentFocusIndex;
      if (i % getDeviceGridColumns() !== 0) {
        focusContentItem(i - 1);
        return;
      }
    }
    // focusSidebar() keeps contentFocusIndex, so RIGHT returns here.
    focusSidebar();
  }

  function handleRight() {
    if (state.focusContext === "sidebar") {
      // RIGHT never opens a page (only ENTER does). Wherever the sidebar
      // highlight is, snap it back to the open page's menu item and
      // restore that page's last focused content item.
      const items = getSidebarItems();
      for (let i = 0; i < items.length; i++) {
        items[i].classList.remove("focused");
        if (items[i].getAttribute("data-page") === state.activePage) {
          state.sidebarIndex = i;
          items[i].classList.add("focused");
        }
      }
      focusContentArea();
    } else if (state.focusContext === "content" && isDeviceGrid()) {
      const i = state.contentFocusIndex;
      const cols = getDeviceGridColumns();
      if (i % cols < cols - 1 && i + 1 < state.contentFocusables.length) {
        focusContentItem(i + 1);
      }
    }
  }

  function handleEnter() {
    if (state.focusContext === "sidebar") {
      const items = getSidebarItems();
      const item = items[state.sidebarIndex];
      if (item) {
        // Back button check
        if (item === dom.backBtn) {
          exitSettings();
          return;
        }
        const page = item.getAttribute("data-page");
        if (page === "signout") {
          openSignOutOverlay();
        } else {
          // navigateTo() resets focus for a new page and keeps the last
          // focused item when ENTER is pressed on the already-open page.
          navigateTo(page);
        }
      }
    } else if (state.focusContext === "content") {
      const el = state.contentFocusables[state.contentFocusIndex];
      if (!el) return;

      // FAQ accordion toggle
      if (el.classList.contains("faq-item")) {
        const idx = parseInt(el.getAttribute("data-index"), 10);
        if (!isNaN(idx)) {
          toggleFaq(idx);
        }
        return;
      }

      // Device card - "This Device" is informational only; every other
      // card's ENTER opens the same remove confirmation as its
      // on-screen "Logout Device" button.
      if (el.classList.contains("device-card")) {
        if (el.classList.contains("this-device-card")) {
          return;
        }
        confirmRemoveDevice(el.getAttribute("data-session-id"));
        return;
      }

      // Account Details card — ENTER starts the delete-account flow,
      // wherever on the card the remote focus currently is.
      if (
        el.classList.contains("account-details-section") ||
        el.id === "delete-account-btn"
      ) {
        startDeleteAccountFlow();
        return;
      }

      // Subscription card — ENTER routes to Cancel or Resume based on
      // the latest known canceled state (handleSubscriptionAction).
      // Custom users render no action button on this card (it's a
      // silent scroll-only stop for them — see focusContentItem()),
      // so ENTER is explicitly a no-op rather than relying on the
      // button being absent.
      if (
        el.classList.contains("subscription-section") ||
        el.id === "subscription-action-btn"
      ) {
        if (!state.isCustomUser) {
          handleSubscriptionAction();
        }
        return;
      }

      // Card Details is a silent scroll-only stop (see
      // focusContentItem()) — ENTER intentionally does nothing here.

      // For non-interactive items, ENTER does nothing
    }
  }

  function handleBack() {
    if (state.focusContext === "content") {
      focusSidebar();
    } else if (state.focusContext === "sidebar") {
      // Exit settings immediately - no confirmation
      exitSettings();
    }
  }

  function handleExit() {
    PopupManager.exit(function (confirmed) {
      if (confirmed) {
        try {
          if (typeof tizen !== "undefined") {
            tizen.application.getCurrentApplication().exit();
          }
        } catch (e) {
          console.warn("Could not exit app");
        }
      }
    });
  }

  // ─── Init ───────────────────────────────────────────────────────────────
  function init() {
    cacheDom();

    // Check JWT
    if (!state.jwt) {
      window.location.href = "../login/login.html";
      return;
    }

    // Register Tizen keys
    try {
      if (typeof tizen !== "undefined" && tizen.tvinputdevice) {
        tizen.tvinputdevice.registerKey("Exit");

        // Register the physical number-pad keys too, so the remote's
        // dial-pad buttons reach the web app for OTP entry instead of
        // being intercepted/consumed by the platform.
        const numberKeys = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        for (let n = 0; n < numberKeys.length; n++) {
          try {
            tizen.tvinputdevice.registerKey(numberKeys[n]);
          } catch (e) {
            // Some Tizen versions don't restrict/require these — ignore.
          }
        }
      }
    } catch (e) {
      // Not in Tizen environment
    }

    // Render sidebar
    renderSidebar();

    // Set initial page title
    if (dom.pageTitle) dom.pageTitle.textContent = "Account";

    // Render default page (Account). Once its data loads, focus lands on
    // the first card (Account Details) via autoFocusContent().
    state.autoFocusPending = true;
    renderPage("account");

    // Setup keyboard listener
    if (document.addEventListener) {
      document.addEventListener("keydown", handleKeyDown);
    }

    // Handle click events on sidebar back button
    if (dom.backBtn) {
      dom.backBtn.addEventListener("click", function () {
        exitSettings();
      });
    }

    // Handle click events on menu items
    dom.menu.addEventListener("click", function (e) {
      const menuItem = e.target.closest(".menu-item");
      if (menuItem) {
        const page = menuItem.getAttribute("data-page");
        if (page) {
          // +1 because back button is at index 0 in getSidebarItems()
          state.sidebarIndex =
            (parseInt(menuItem.getAttribute("data-index"), 10) || 0) + 1;
          if (page === "signout") {
            openSignOutOverlay();
          } else {
            navigateTo(page);
          }
        }
      }
    });

    // Sign Out button click handlers
    if (dom.signoutBtnNo) {
      dom.signoutBtnNo.addEventListener("click", closeSignOutOverlay);
    }
    if (dom.signoutBtnYes) {
      dom.signoutBtnYes.addEventListener("click", handleSignOut);
    }

    // Delete Account OTP overlay: numeric keypad + button handlers
    // (keypad also drives the remote/D-pad flow via deleteOtpPad.handleKey)
    deleteOtpPad = createOtpPad({
      boxes: dom.deleteOtpBoxes,
      keypad: dom.deleteOtpKeypad,
      errorEl: dom.deleteOtpError,
      verifyBtn: dom.deleteOtpVerifyBtn,
      resendBtn: dom.deleteOtpResendBtn,
      onVerify: verifyDeleteOtp,
      onResend: resendDeleteOtp,
      onClose: function () {
        confirmStopOtpProcess("Delete Account", closeDeleteOtpOverlay);
      },
    });
    if (dom.deleteOtpVerifyBtn) {
      dom.deleteOtpVerifyBtn.addEventListener("click", verifyDeleteOtp);
    }
    if (dom.deleteOtpResendBtn) {
      dom.deleteOtpResendBtn.addEventListener("click", function () {
        if (!dom.deleteOtpResendBtn.disabled) resendDeleteOtp();
      });
    }

    // Resume Subscription OTP overlay: numeric keypad + button handlers
    // (keypad also drives the remote/D-pad flow via resumeSubOtpPad.handleKey)
    resumeSubOtpPad = createOtpPad({
      boxes: dom.resumeSubOtpBoxes,
      keypad: dom.resumeSubOtpKeypad,
      errorEl: dom.resumeSubOtpError,
      verifyBtn: dom.resumeSubOtpVerifyBtn,
      resendBtn: dom.resumeSubOtpResendBtn,
      onVerify: verifyResumeSubOtp,
      onResend: resendResumeSubOtp,
      onClose: function () {
        confirmStopOtpProcess("Resume Subscription", closeResumeSubOtpOverlay);
      },
    });
    if (dom.resumeSubOtpVerifyBtn) {
      dom.resumeSubOtpVerifyBtn.addEventListener("click", verifyResumeSubOtp);
    }
    if (dom.resumeSubOtpResendBtn) {
      dom.resumeSubOtpResendBtn.addEventListener("click", function () {
        if (!dom.resumeSubOtpResendBtn.disabled) resendResumeSubOtp();
      });
    }

    // Cancel Subscription password overlay: click handlers
    // (mouse/touch support; remote/D-pad flow is handled via handleCancelSubPasswordKeys)
    if (dom.cancelSubCancelBtn) {
      dom.cancelSubCancelBtn.addEventListener(
        "click",
        closeCancelSubPasswordOverlay,
      );
    }
    if (dom.cancelSubSubmitBtn) {
      dom.cancelSubSubmitBtn.addEventListener(
        "click",
        verifySubscriptionCancelPassword,
      );
    }
    if (dom.cancelSubInput) {
      dom.cancelSubInput.addEventListener("focus", function () {
        state.cancelSubFocusIndex = CANCEL_SUB_FOCUS_ORDER.indexOf("input");
      });
      dom.cancelSubInput.addEventListener("keydown", function (e) {
        if (e.keyCode === KEYS.ENTER && !isLoadingVisible()) {
          if (e.preventDefault) e.preventDefault();
          verifySubscriptionCancelPassword();
        }
      });
    }
  }

  // Auto-init
  if (document.readyState === "loading") {
    if (document.addEventListener) {
      document.addEventListener("DOMContentLoaded", init);
    } else if (document.attachEvent) {
      document.attachEvent("onreadystatechange", function () {
        if (document.readyState === "complete") init();
      });
    }
  } else {
    init();
  }

  return {
    init: init,
    navigateTo: navigateTo,
    focusSidebar: focusSidebar,
    focusContentArea: focusContentArea,
  };
})();
