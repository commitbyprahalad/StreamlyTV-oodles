"use strict";

const init = function () {
    LoadingManager.show();
    loginguide();
    document.getElementById("privacy_popup").focus();
    initTizenKeys();
    initModalClicks();
};
window.onload = init;

// ─── Remote focus map (guide screen, no modal open) ─────────────────────────
const FOCUS_MAP = {
    left: { "help_popup": "privacy_popup" },
    right: { "privacy_popup": "help_popup" },
    up: { "privacy_popup": "help_popup", "help_popup": "privacy_popup", "signinbutton": "privacy_popup" },
    down: { "privacy_popup": "signinbutton", "help_popup": "signinbutton" }
};

// ─── Modals ─────────────────────────────────────────────────────────────────
// Each modal returns focus to the button that opened it. While a modal is
// open, UP/DOWN scroll its content (focus stays on the modal box, so the
// content never jumps). The Privacy modal's OK button is only shown and
// focused once the user has scrolled to the bottom.
const MODALS = {
    "privacy_modal": { opener: "privacy_popup" },
    "help_modal": { opener: "help_popup" }
};
const MODAL_SCROLL_STEP = 50;
const SCROLL_END_TOLERANCE = 5; // px, treat "almost at the end" as the end

let openModalId = null;

function initTizenKeys() {
    document.addEventListener('keydown', function (e) {
        const keyActions = {
            37: keyLeft,
            38: keyUp,
            39: keyRight,
            40: keyDown,
            13: keyOk,
            10009: handleReturnKey,
            10182: showExitPopup
        };

        // Delegate to PopupManager if popup is open
        if (typeof PopupManager !== 'undefined' && PopupManager.isOpen()) {
            PopupManager.handleKey(e.keyCode);
            return;
        }

        if (keyActions[e.keyCode]) {
            // Arrow keys would otherwise also scroll the modal natively
            if (e.keyCode === 38 || e.keyCode === 40) e.preventDefault();
            keyActions[e.keyCode]();
        } else {
            console.log('Key code : ' + e.keyCode);
        }
    });
}

function initModalClicks() {
    const okBtn = document.getElementById("priok");
    if (okBtn) okBtn.addEventListener("click", function () { closeModal("privacy_modal"); });
}

function showExitPopup() {
    PopupManager.exit(function (confirmed) {
        if (confirmed) {
            try { tizen.application.getCurrentApplication().exit(); } catch (error) { console.error("Failed to exit application:", error); }
        }
    });
}

function handleReturnKey() {
    if (openModalId) {
        closeModal(openModalId);
        return;
    }
    showExitPopup();
}

function navigateFocus(mapping) {
    const targetId = mapping[document.activeElement.id];
    if (targetId) document.getElementById(targetId).focus();
}

function keyLeft() {
    if (openModalId) return;
    navigateFocus(FOCUS_MAP.left);
}

function keyRight() {
    if (openModalId) return;
    navigateFocus(FOCUS_MAP.right);
}

function keyUp() {
    if (!openModalId) {
        navigateFocus(FOCUS_MAP.up);
        return;
    }

    // Leaving the OK button: hide it again and go back to reading
    if (openModalId === "privacy_modal" && document.activeElement.id === "priok") {
        setPrivacyOkVisible(false);
        focusModalBox("privacy_modal");
    }
    scrollModal(openModalId, "up");
}

function keyDown() {
    if (!openModalId) {
        navigateFocus(FOCUS_MAP.down);
        return;
    }

    if (openModalId === "privacy_modal") {
        if (document.activeElement.id === "priok") return; // already at the end
        scrollModal("privacy_modal", "down");
        revealPrivacyOkIfAtEnd();
        return;
    }
    scrollModal(openModalId, "down");
}

function keyOk() {
    if (openModalId) {
        // Privacy closes from its OK button; Help closes with BACK
        if (openModalId === "privacy_modal" && document.activeElement.id === "priok") {
            closeModal("privacy_modal");
        }
        return;
    }

    const actions = {
        "signinbutton": function () { window.location.href = "../login/login.html"; },
        "help_popup": function () { openModal("help_modal"); },
        "privacy_popup": function () { openModal("privacy_modal"); }
    };
    const action = actions[document.activeElement.id];
    if (action) action();
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    openModalId = modalId;
    modal.style.display = "block";
    modal.scrollTop = 0; // always start reading from the top

    if (modalId === "privacy_modal") setPrivacyOkVisible(false);
    focusModalBox(modalId);

    // Short policy text that needs no scrolling: OK is available right away
    if (modalId === "privacy_modal") revealPrivacyOkIfAtEnd();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = "none";
    if (modalId === "privacy_modal") setPrivacyOkVisible(false);
    openModalId = null;

    const opener = document.getElementById(MODALS[modalId].opener);
    if (opener) opener.focus();
}

// Focus the modal box itself (not a child), so the browser has nothing to
// scroll into view and the content stays where it is.
function focusModalBox(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    try {
        modal.focus({ preventScroll: true });
    } catch (e) {
        modal.focus();
    }
}

function scrollModal(modalId, direction) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.scrollTop += direction === "up" ? -MODAL_SCROLL_STEP : MODAL_SCROLL_STEP;
}

function isScrolledToEnd(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_END_TOLERANCE;
}

function revealPrivacyOkIfAtEnd() {
    const modal = document.getElementById("privacy_modal");
    if (!modal || !isScrolledToEnd(modal)) return;
    setPrivacyOkVisible(true);
    document.getElementById("priok").focus();
}

// Hidden with visibility (not display) so the content height — and the
// scroll position — doesn't change when the button appears.
function setPrivacyOkVisible(visible) {
    const okBtn = document.getElementById("priok");
    if (okBtn) okBtn.classList.toggle("is-hidden", !visible);
}

function removeFocus(id) {
    const className = id + "_style";
    const el = document.getElementsByClassName(className)[0];
    if (el) el.classList.remove(className);
}

function setItem(key, item) {
    localStorage.setItem(key, JSON.stringify(item));
}

function getItem(key) {
    return JSON.parse(localStorage.getItem(key));
}

function fetchTermsOfUse() {
    const token = localStorage.getItem("jwt token");
    fetch(API.TERMS_OF_USE, {
        method: 'GET',
        headers: { "Authorization": "Bearer " + token }
    })
        .then(response => response.json())
        .then(function (result) { document.getElementById("termofuse").innerHTML = result.data; })
        .catch(function (error) { console.log('error', error); });
}
fetchTermsOfUse();

// Privacy & Policy modal text comes from the API as plain text: first line is
// the title, blank lines separate paragraphs.
function fetchPrivacyPolicy() {
    const token = localStorage.getItem("jwt token");
    const headers = { "Accept": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    fetch(API.PRIVACY_POLICY, { method: 'GET', headers: headers })
        .then(response => response.json())
        .then(function (result) {
            const text = result && typeof result.data === "string" ? result.data.trim() : "";
            if (!text) throw new Error("Empty privacy policy");
            populatePrivacyPolicy(text);
        })
        .catch(function (error) {
            console.log('error', error);
            document.getElementById("privacy_content").innerHTML =
                "<p>Failed to load Privacy &amp; Policy. Please try again later.</p>";
            refreshOpenPrivacyModal();
        });
}
fetchPrivacyPolicy();

function escapePolicyHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function populatePrivacyPolicy(text) {
    const lines = text.split(/\r?\n/);
    const title = lines.shift().trim();
    if (title) document.getElementById("privacy_title").textContent = title;

    const paragraphs = lines.join("\n").split(/\n\s*\n/);
    let html = "";
    for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i].trim();
        if (para) html += "<p>" + escapePolicyHtml(para).replace(/\n/g, "<br>") + "</p>";
    }
    document.getElementById("privacy_content").innerHTML = html;
    refreshOpenPrivacyModal();
}

// If the modal was opened while "Loading..." was showing, the OK button may
// already be visible; re-check it against the real content length.
function refreshOpenPrivacyModal() {
    if (openModalId !== "privacy_modal") return;
    setPrivacyOkVisible(false);
    focusModalBox("privacy_modal");
    revealPrivacyOkIfAtEnd();
}

// Fetch Help/Support contact data from API
function fetchSupportInfo() {
    fetch(API.SUPPORT, {
        method: 'GET'
    })
        .then(response => response.json())
        .then(function (result) {
            if (!result || !result.success || !result.data) return;

            const data = result.data;
            const message = result.message || "";

            const lines = message.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);

            if (lines[0]) document.getElementById("help_message_1").innerHTML = lines[0];
            if (lines[1]) document.getElementById("help_message_2").innerHTML = lines[1];

            if (data.email) document.getElementById("help_email").innerHTML = data.email;
            if (data.num1) document.getElementById("help_phone").innerHTML = data.num1;
        })
        .catch(function (error) { console.log('support fetch error', error); });
}
fetchSupportInfo();

function loginguide() {
    return new Promise(function (resolve, reject) {
        const requestOptions = { method: 'POST' };
        fetch(API.LOGIN_GUIDE, requestOptions)
            .then(function (response) { return response.json(); })
            .then(function (result) {
                LoadingManager.hide();
                document.getElementById("head1").innerHTML = result.data[0].title;
                document.getElementById("title1").innerHTML = result.data[0].description;
                document.getElementById("head2").innerHTML = result.data[1].title;
                document.getElementById("title2").innerHTML = result.data[1].description;
                document.getElementById("head3").innerHTML = result.data[2].title;
                document.getElementById("title3").innerHTML = result.data[2].description;
            })
            .catch(function (error) {
                console.log('error', error);
            });
    });
}