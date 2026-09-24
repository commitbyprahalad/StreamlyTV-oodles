document.addEventListener('DOMContentLoaded', function () {
    const deviceList = JSON.parse(localStorage.getItem('deviceList')) || JSON.parse(localStorage.getItem('devices')) || [];
    const deviceContainer = document.querySelector('.devices-container');

    // Update device count text
    const countEl = document.getElementById('device-count-text');
    if (countEl) {
        countEl.textContent = 'Total connected devices: ' + deviceList.length;
    }

    // ─── Helper to get personal device name ─────────────────────────────────
    function getPersonalDeviceName(device) {
        const name = device.personaldevicename;
        if (name === null || name === undefined || name === '') {
            return 'NA';
        }
        return name;
    }

    // ─── Time Ago Helper ────────────────────────────────────────────────────
    function timeAgo(dateString) {
        if (!dateString) return 'N/A';
        const now = new Date();
        const past = new Date(dateString.replace(' ', 'T'));
        const diffInSeconds = Math.floor((now - past) / 1000);
        const seconds = diffInSeconds % 60;
        const minutes = Math.floor(diffInSeconds / 60) % 60;
        const hours = Math.floor(diffInSeconds / 3600) % 24;
        const days = Math.floor(diffInSeconds / 86400);
        if (days > 0) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
        if (hours > 0) return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
        if (minutes > 0) return minutes + ' minute' + (minutes > 1 ? 's' : '') + ' ago';
        return seconds + ' second' + (seconds > 1 ? 's' : '') + ' ago';
    }

    // ─── Render Devices ─────────────────────────────────────────────────────
    function renderDevices() {
        deviceContainer.innerHTML = '';
        if (deviceList.length === 0) {
            deviceContainer.innerHTML = '<p style="color:white;font-size:28px;">No devices connected.</p>';
            return;
        }

        deviceList.forEach(function (device) {
            const card = document.createElement('div');
            card.className = 'device-card';
            card.setAttribute('tabindex', '0');
            card.setAttribute('data-session-id', device.session_id || '');

            card.innerHTML =
                '<div class="device-card-icon">' +
                '  <img src="../images/normaltv.png" alt="TV">' +
                '</div>' +
                '<div class="device-card-info">' +
                '  <p class="device-name">' + (device.device_name || 'Device') + '</p>' +
                '  <p class="device-detail"><span>IP:</span> ' + (device.user_ip || 'N/A') + '</p>' +
                '  <p class="device-detail"><span>Type:</span> ' + (device.device_type || 'N/A') + '</p>' +
                '  <p class="device-detail"><span>Login:</span> ' + timeAgo(device.logintime) + '</p>' +
                '  <p class="device-detail"><span>Name:</span> ' + getPersonalDeviceName(device) + '</p>' +
                '</div>';

            // Focus management
            card.addEventListener('focus', function () { card.classList.add('focused'); });
            card.addEventListener('blur', function () { card.classList.remove('focused'); });

            // OK/Enter on card → show remove device popup
            card.addEventListener('keydown', function (e) {
                if (e.keyCode === 13) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sid = card.getAttribute('data-session-id');
                    PopupManager.showConfirm('Are you sure you want to remove this device?', function (confirmed) {
                        if (confirmed) {
                            logoutDevice(sid);
                        } else {
                            setTimeout(function () { card.focus(); }, 50);
                        }
                    });
                }
            });

            deviceContainer.appendChild(card);
        });

        // Focus first card
        setTimeout(function () {
            const first = document.querySelector('.device-card');
            if (first) first.focus();
        }, 100);
    }

    // ─── Remove Device ──────────────────────────────────────────────────────
    function logoutDevice(sessionId) {
        LoadingManager.show();

        fetch(API.SAME_DEVICE_ID_LOGOUT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sessionId })
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('HTTP error! status: ' + response.status);
                }
                return response.json();
            })
            .then(function (logoutData) {
                if (AuthSession.checkApiResponse(logoutData)) return;
                if (logoutData.success) {
                    // Re-login to get updated device list
                    relogin();
                } else {
                    LoadingManager.hide();
                    PopupManager.showAlert(logoutData.message || 'Failed to remove device.');
                }
            })
            .catch(function (error) {
                LoadingManager.hide();
                console.error('Error during logout:', error);
                PopupManager.showAlert('Network error. Please try again.');
            });
    }

    // ─── Re-login to refresh device list ────────────────────────────────────
    function relogin() {
        const uid = localStorage.getItem('deviceid') || '';
        const formData = new FormData();
        let url = API.LOGIN;

        // Re-login with the same method the user originally logged in with.
        if (localStorage.getItem('loginMethod') === 'passcode') {
            url = API.LOGIN_WITH_PASSCODE;
            formData.append('passcode', localStorage.getItem('passcode') || '');
        } else {
            formData.append('email', localStorage.getItem('email') || '');
            formData.append('password', localStorage.getItem('password') || '');
        }
        formData.append('deviceid', uid);

        fetch(url, {
            method: 'POST',
            body: formData,
            mode: 'cors',
            headers: { 'Accept': 'application/json' }
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                LoadingManager.hide();
                if (AuthSession.checkApiResponse(data)) return;
                if (data.response_code === 479 && data.loggedindeviceinfolist && data.loggedindeviceinfolist.data) {
                    localStorage.setItem('deviceList', JSON.stringify(data.loggedindeviceinfolist.data));
                    localStorage.setItem('jwt token', data.access_token);
                    window.location.reload();
                } else if (data.success) {
                    localStorage.setItem('jwt token', data.access_token);
                    if (data.personaldevicename_popup) {
                        window.location.href = '../personaldevice/personaldevice.html';
                    } else if (data.userrole === 'tieruser' && data.user && data.user.is_custom_user === 0) {
                        window.location.href = '../hotelroom/hotelroom.html';
                    } else {
                        window.location.href = '../programmeguide/epg.html';
                    }
                } else {
                    window.location.href = '../login/login.html';
                }
            })
            .catch(function () {
                LoadingManager.hide();
                PopupManager.showAlert('Network error. Please try again.');
            });
    }

    // ─── Key Navigation ─────────────────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        if (typeof PopupManager !== 'undefined' && PopupManager.isOpen()) {
            PopupManager.handleKey(e.keyCode);
            e.preventDefault();
            return;
        }

        const cards = document.querySelectorAll('.device-card');

        switch (e.keyCode) {
            case 37: // LEFT
            case 38: // UP
                e.preventDefault();
                const idx = Array.from(cards).indexOf(document.activeElement);
                if (idx > 0) {
                    cards[idx - 1].focus();
                }
                break;
            case 39: // RIGHT
            case 40: // DOWN
                e.preventDefault();
                const idx2 = Array.from(cards).indexOf(document.activeElement);
                if (idx2 >= 0 && idx2 < cards.length - 1) {
                    cards[idx2 + 1].focus();
                }
                break;
            case 13: // OK/ENTER
                e.preventDefault();
                break;
            case 10009: // BACK
                e.preventDefault();
                window.location.href = '../login/login.html';
                break;
            case 10182: // EXIT
                e.preventDefault();
                PopupManager.showConfirm('Do you want to exit?', function (confirmed) {
                    if (confirmed) {
                        try { tizen.application.getCurrentApplication().exit(); } catch (e) { }
                    }
                });
                break;
        }
    });

    // ─── Init ───────────────────────────────────────────────────────────────
    renderDevices();
});