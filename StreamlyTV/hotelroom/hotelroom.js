// ─── State ───────────────────────────────────────────────────────────────────
const token = localStorage.getItem("jwt token");
let rooms = [];
let filteredRooms = [];
let selectedRoomPos = 0;
let focusZone = 'grid'; // 'logout' | 'search' | 'grid'

// ─── Session Validation ──────────────────────────────────────────────────────

/**
 * Check JWT token exists. If missing, redirect to login.
 * Returns true if token exists, false otherwise.
 */
function validateToken() {
    const token = localStorage.getItem("jwt token");
    if (!token) {
        AuthSession.handleSessionExpired();
        return false;
    }
    return true;
}

// ─── Init ────────────────────────────────────────────────────────────────────
const init = async function () {
    // Validate session on page load — if JWT is expired, show popup immediately
    if (!validateToken()) return;

    // Check if session was marked as expired by another screen
    if (localStorage.getItem('session_expire') === 'session_expire') {
        AuthSession.handleSessionExpired();
        return;
    }

    const _stored = JSON.parse(localStorage.getItem("rooms")) || [];
    rooms = Array.isArray(_stored) ? _stored : [];

    if (rooms.length === 0) {
        await hotelrooms();
        return;
    }

    setupAndRender();
};

window.onload = init;

// ─── Setup & Render ───────────────────────────────────────────────────────────
function setupAndRender() {
    if (rooms.length === 0) {
        showNoRoomsPopup();
        return;
    }

    // Rooms come either from the login response (localStorage) or from the
    // get-hotelrooms API, both in descending order — always show ascending.
    sortRoomsAscending(rooms);
    updateRoomCount();
    filteredRooms = rooms.slice();
    renderRooms(filteredRooms);
    selectedRoomPos = 0;
    focusZone = 'grid';
    highlightCard(0);

    setupSearchFilter();
    initTizenKeys();
    setupLogoutClick();
}

// ─── Room Sorting ─────────────────────────────────────────────────────────────
// Natural order on the room name, so "Room 2" < "Room 10" and names with a
// text prefix (e.g. "Room 20") still sort by their number.
function sortRoomsAscending(list) {
    list.sort(function (a, b) {
        return String(a.hotel_room || '').localeCompare(String(b.hotel_room || ''), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    });
}

// ─── Room Count Label ─────────────────────────────────────────────────────────
function updateRoomCount() {
    const el = document.getElementById('room-count');
    if (el) el.textContent = 'Total Available Rooms: ' + rooms.length;
}

// ─── Key Handling ─────────────────────────────────────────────────────────────
function initTizenKeys() {
    document.addEventListener('keydown', function (e) {
        // Delegate to PopupManager if popup is open
        if (typeof PopupManager !== 'undefined' && PopupManager.isOpen()) {
            PopupManager.handleKey(e.keyCode);
            return;
        }

        // RETURN / Back key
        if (e.keyCode === 10009) {
            showExitPopup();
            return;
        }

        // Hardware Exit key
        try {
            if (e.keyCode === tizen.tvinputdevice.getKey('Exit').code) {
                showExitPopup();
                return;
            }
        } catch (_) { }

        switch (e.keyCode) {
            case 37: handleLeft(); break;
            case 38: handleUp(); break;
            case 39: handleRight(); break;
            case 40: handleDown(); break;
            case 13: handleOk(); break;
        }
    });
}

// ─── Direction Handlers ───────────────────────────────────────────────────────
function handleUp() {
    if (focusZone === 'logout') return;

    if (focusZone === 'search') {
        setFocusZone('logout');
        return;
    }

    if (focusZone === 'grid') {
        const newPos = selectedRoomPos - 5;
        if (newPos >= 0) {
            selectedRoomPos = newPos;
            highlightCard(selectedRoomPos);
            scrollCardIntoView(selectedRoomPos);
        } else {
            clearCardHighlight();
            setFocusZone('search');
        }
    }
}

function handleDown() {
    if (focusZone === 'logout') { setFocusZone('search'); return; }

    if (focusZone === 'search') {
        setFocusZone('grid');
        highlightCard(selectedRoomPos);
        return;
    }

    if (focusZone === 'grid') {
        const newPos = selectedRoomPos + 5;
        if (newPos < filteredRooms.length) {
            selectedRoomPos = newPos;
            highlightCard(selectedRoomPos);
            scrollCardIntoView(selectedRoomPos);
        }
    }
}

function handleLeft() {
    if (focusZone === 'grid' && selectedRoomPos > 0) {
        selectedRoomPos--;
        highlightCard(selectedRoomPos);
        scrollCardIntoView(selectedRoomPos);
    }
}

function handleRight() {
    if (focusZone === 'grid' && selectedRoomPos < filteredRooms.length - 1) {
        selectedRoomPos++;
        highlightCard(selectedRoomPos);
        scrollCardIntoView(selectedRoomPos);
    }
}

function handleOk() {
    if (focusZone === 'logout') {
        showLogoutPopup();
        return;
    }

    if (focusZone === 'grid') {
        const selectedRoom = filteredRooms[selectedRoomPos];
        if (!selectedRoom) return;

        // Validate session before allowing room selection
        if (typeof AuthSession !== 'undefined' && AuthSession.addToRecentCheck) {
            AuthSession.addToRecentCheck(function (result) {
                if (result === 'expired') return; // popup already shown
                showRoomConfirmPopup(selectedRoom);
            });
        } else {
            showRoomConfirmPopup(selectedRoom);
        }
    }
}

// ─── Focus Zone Management ────────────────────────────────────────────────────
function setFocusZone(zone) {
    focusZone = zone;
    document.getElementById('logout').classList.remove('focused');

    if (zone === 'logout') {
        focusZone = 'logout';
        document.getElementById('logout').classList.add('focused');
        document.getElementById('logout').focus();
    } else if (zone === 'search') {
        document.getElementById('search').focus();
    } else {
        document.getElementById('search').blur();
        document.getElementById('logout').blur();
        highlightCard(selectedRoomPos);
    }
}

// ─── Card Highlight ───────────────────────────────────────────────────────────
function highlightCard(pos) {
    document.querySelectorAll('.room-card').forEach(function (c) { c.classList.remove('focused'); });
    const card = document.getElementById('card-' + pos);
    if (card) card.classList.add('focused');
    focusZone = 'grid';
}

function clearCardHighlight() {
    document.querySelectorAll('.room-card').forEach(function (c) { c.classList.remove('focused'); });
}

function scrollCardIntoView(pos) {
    const card = document.getElementById('card-' + pos);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Render Rooms ─────────────────────────────────────────────────────────────
function renderRooms(roomList) {
    filteredRooms = roomList;
    const grid = document.getElementById('room-grid');
    grid.innerHTML = '';

    if (!roomList.length) return;

    let row = null;
    roomList.forEach(function (room, index) {
        if (index % 5 === 0) {
            row = document.createElement('div');
            row.className = 'room-row';
            grid.appendChild(row);
        }

        const card = document.createElement('div');
        card.className = 'room-card';
        card.id = 'card-' + index;
        card.innerHTML =
            '<img src="../images/ic_room@3x.png" alt="Room" class="room-card-icon">' +
            '<div class="room-card-name">' + escapeHtml(room.hotel_room) + '</div>';

        card.addEventListener('click', function () {
            if (PopupManager.isOpen()) return;
            selectedRoomPos = index;
            highlightCard(index);
            handleOk();
        });

        row.appendChild(card);
    });

    if (selectedRoomPos >= filteredRooms.length) selectedRoomPos = 0;
    if (focusZone === 'grid') highlightCard(selectedRoomPos);
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Search Filter ────────────────────────────────────────────────────────────
function setupSearchFilter() {
    document.getElementById('search').addEventListener('keyup', function (e) {
        const query = e.target.value.toLowerCase().trim();
        const result = rooms.filter(function (room) {
            return room.hotel_room.toLowerCase().includes(query);
        });
        selectedRoomPos = 0;
        renderRooms(result);
    });
}

// ─── Popup: Room Confirm ─────────────────────────────────────────────────────
function showRoomConfirmPopup(room) {
    PopupManager.showConfirm(
        'Are you sure you want to select ' + room.hotel_room + '?',
        function (confirmed) {
            if (!confirmed) return;

            LoadingManager.show();
            syncRoom(room.id).then(function (synced) {
                LoadingManager.hide();

                if (synced === 'auth') {
                    return;
                }

                if (synced) {
                    localStorage.setItem("selected_room", JSON.stringify(room));
                    localStorage.setItem("video_selected_loc", selectedRoomPos);
                    location.href = "../programmeguide/epg.html";
                } else {
                    PopupManager.showAlert("Could not sync room. Please try again.");
                }
            });
        },
        'Yes', 'Cancel'
    );
}

function setupLogoutClick() {
    const btn = document.getElementById('logout');
    if (btn) {
        btn.addEventListener('click', showLogoutPopup);
        // Remote key ENTER support on the button itself
        btn.addEventListener('keydown', function (e) {
            if (e.keyCode === 13) {
                e.preventDefault();
                e.stopPropagation();
                showLogoutPopup();
            }
        });
    }
}

function showLogoutPopup() {
    PopupManager.logout(function (confirmed) {
        if (confirmed) logout();
    });
}

function showExitPopup() {
    PopupManager.exit(function (confirmed) {
        if (confirmed) {
            localStorage.removeItem("selected_room");
            localStorage.removeItem("video_selected_loc");
            try { tizen.application.getCurrentApplication().exit(); } catch (_) { }
        }
    });
}

function showNoRoomsPopup() {
    PopupManager.showConfirm(
        'No rooms available. Would you like to retry?',
        function (confirmed) {
            if (confirmed) {
                hotelrooms();
            }
        },
        'Retry', 'Cancel'
    );
}

// ─── Logout API ───────────────────────────────────────────────────────────────
function logout() {
    LoadingManager.show();
    const headers = new Headers();
    headers.append("Authorization", "Bearer " + (localStorage.getItem("jwt token") || ""));
    headers.append("Accept", "application/json");

    fetch(API.LOGOUT, {
        method: 'POST', headers: headers, redirect: 'follow'
    })
        .then(function (res) { return res.json(); })
        .then(function (data) {
            LoadingManager.hide();
            if (data.success === true) {
                clearSession();
                location.href = "../login/login.html";
            } else {
                // Even if API fails, clear session and redirect
                clearSession();
                location.href = "../login/login.html";
            }
        })
        .catch(function (err) {
            LoadingManager.hide();
            console.error('Logout error:', err);
            // Network error — still clear local session
            clearSession();
            location.href = "../login/login.html";
        });
}

function clearSession() {
    localStorage.removeItem("user_id");
    localStorage.removeItem("email");
    localStorage.removeItem("password");
    localStorage.removeItem("deviceid");
    localStorage.removeItem("version");
    localStorage.removeItem("personaldeviceid");
    localStorage.removeItem("devicetype");
    localStorage.removeItem("userrole");
    localStorage.removeItem("is_custom_user");
    localStorage.removeItem("user_type");
    localStorage.removeItem("jwt token");
    localStorage.removeItem("rooms");
    localStorage.removeItem("personaldevicename_popup");
    localStorage.removeItem("devicename");
    localStorage.removeItem("deviceList");
    localStorage.removeItem("devices");
    localStorage.removeItem("latitude");
    localStorage.removeItem("longitude");
    localStorage.removeItem("remembered");
    localStorage.removeItem("selected_room");
    localStorage.removeItem("video_selected_loc");
}

// ─── Sync Room API ────────────────────────────────────────────────────────────
async function syncRoom(roomid) {
    const headers = new Headers();
    headers.append("Accept", "application/json");
    headers.append("Authorization", "Bearer " + (localStorage.getItem("jwt token") || ""));

    const formdata = new FormData();
    formdata.append("roomid", roomid);

    try {
        const response = await fetch(
            API.SYNC_SESSION_WITH_ROOM,
            { method: 'POST', headers: headers, body: formdata }
        );
        if (response.ok) {
            const result = await response.json();

            // Check for session/subscription expired in response body
            if (result.response_code === 401) {
                AuthSession.handleSessionExpired();
                return 'auth';
            }
            if (result.response_code === 410) {
                AuthSession.handleSubscriptionExpired(result.subscribedmsgis || result.message);
                return 'auth';
            }

            return result.success === true;
        }
    } catch (err) {
        console.error('syncRoom error:', err);
    }
    return false;
}

// ─── Get Hotel Rooms (API fetch) ──────────────────────────────────────────────
async function hotelrooms() {
    LoadingManager.show();
    const headers = new Headers();
    headers.append("Accept", "application/json");
    headers.append("Authorization", "Bearer " + (localStorage.getItem("jwt token") || ""));

    try {
        const res = await fetch(API.GET_HOTEL_ROOMS, {
            method: 'POST', headers: headers, body: new FormData()
        });
        const result = await res.json();

        // Check for session/subscription expired
        if (result.response_code === 401) {
            LoadingManager.hide();
            AuthSession.handleSessionExpired();
            return;
        }
        if (result.response_code === 410) {
            LoadingManager.hide();
            AuthSession.handleSubscriptionExpired(result.subscribedmsgis || result.message);
            return;
        }

        if (result && result.data && result.data.length > 0) {
            rooms = result.data.slice();
            localStorage.setItem("rooms", JSON.stringify(rooms));
        } else {
            rooms = [];
        }
    } catch (err) {
        console.error('hotelrooms error:', err);
        rooms = [];
    }

    LoadingManager.hide();
    initTizenKeys();
    setupAndRender();
}