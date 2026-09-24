/**
 * EPG Auto-Refresh System
 * 
 * Automatically updates the EPG every 30 minutes to:
 * - Hide the completed time slot
 * - Add a new future slot
 * - Keep the EPG current and relevant
 * 
 * Add this to modern-epg-core.js or create as a new file
 */

EPG.autoRefresh = {
    refreshTimer: null,
    SLOT_DURATION: 1800, // 30 minutes in seconds

    /**
     * Initialize auto-refresh system
     * Called after initial EPG render
     */
    init: function () {
        console.log('🔄 Initializing EPG auto-refresh system');

        // Calculate time until next 30-minute mark
        const now = new Date();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();

        // Time to next 30-minute mark (either :00 or :30)
        let minutesToNext30;
        if (minutes < 30) {
            minutesToNext30 = 30 - minutes;
        } else {
            minutesToNext30 = 60 - minutes;
        }

        const millisecondsToNext = ((minutesToNext30 * 60) - seconds) * 1000;

        console.log('⏰ Next EPG refresh in:', Math.floor(millisecondsToNext / 1000), 'seconds');

        // Schedule first refresh at next 30-minute mark
        const self = this;
        setTimeout(function () {
            self.refreshEPG();
            // Then refresh every 30 minutes
            self.refreshTimer = setInterval(function () {
                self.refreshEPG();
            }, self.SLOT_DURATION * 1000); // 30 minutes
        }, millisecondsToNext);
    },

    /**
     * Refresh the EPG by hiding past slot and adding future slot
     */
    refreshEPG: function () {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔄 Auto-refreshing EPG - hiding past slot');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        if (!EPG.state || !EPG.state.firstSlotTime) {
            console.warn('⚠️ EPG state not initialized');
            return;
        }

        // Update firstSlotTime to next slot (add 30 minutes)
        EPG.state.firstSlotTime += this.SLOT_DURATION;

        const newStartTime = new Date(EPG.state.firstSlotTime * 1000);
        console.log('📅 New EPG start time:', newStartTime.toLocaleTimeString());

        // Re-render time header
        if (EPG.ui && EPG.ui.renderTimeHeader) {
            EPG.ui.renderTimeHeader();
        }

        // Re-render program grid with new time window
        if (EPG.state.channels && EPG.state.channels.length > 0 && EPG.ui && EPG.ui.renderProgramGrid) {
            EPG.ui.renderProgramGrid(EPG.state.channels);
        }

        // Scroll back to beginning (show current time)
        const programGrid = document.getElementById('program-grid');
        const timeHeader = document.getElementById('time-header');
        if (programGrid && timeHeader) {
            programGrid.scrollLeft = 0;
            timeHeader.scrollLeft = 0;
        }

        // Update live indicator
        if (EPG.ui && EPG.ui.updateLiveIndicator) {
            EPG.ui.updateLiveIndicator();
        }

        // Update day indicator
        if (EPG.ui && EPG.ui.updateDayIndicator) {
            EPG.ui.updateDayIndicator();
        }

        // Restore focus to current position
        if (EPG.focus && EPG.focus.restoreFocus) {
            // Reset to first channel to avoid focusing on a program that's now hidden
            if (EPG.focus.state.channelIndex >= 0) {
                EPG.focus.focusChannel(EPG.focus.state.channelIndex);
            }
        }

        console.log('✅ EPG refreshed successfully');
    },

    /**
     * Stop auto-refresh (call when leaving EPG page)
     */
    stop: function () {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
            console.log('🛑 EPG auto-refresh stopped');
        }
    }
};

// Auto-start when EPG is rendered
// Add this to the end of EPG.ui.renderEPG() function:
/*
if (typeof EPG.autoRefresh !== 'undefined') {
    EPG.autoRefresh.init();
}
*/

console.log('✅ EPG Auto-Refresh System loaded');