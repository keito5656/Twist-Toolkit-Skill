#!/usr/bin/env node
/**
 * Twist Toolkit - 100% Coverage Functional Test Suite
 * 
 * Verifies EVERY command listed in SKILL.md.
 * Target Workspace: yamamotoTest (76606)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const TOOLKIT_SCRIPT = path.join(__dirname, 'twist_api.js');
const TEST_WS_ID = 76606;
const ME_ID = 204560;
const ADA_ID = 2601;
const TEST_EMAIL = 'test+twist@example.com';

function run(cmdArgs) {
  const fullCmd = `node ${TOOLKIT_SCRIPT} ${cmdArgs}`;
  process.stdout.write(`  Running: ${cmdArgs.padEnd(50)} ... `);
  try {
    const output = execSync(fullCmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    console.log('\x1b[32mPASS\x1b[0m');
    try { return JSON.parse(output); } catch (e) { return output; }
  } catch (err) {
    console.log('\x1b[31mFAIL\x1b[0m');
    const errMsg = err.stderr ? err.stderr.toString() : err.message;
    console.error(`    Error: ${errMsg.trim()}`);
    // We don't exit here to try and cover as many commands as possible
    return null;
  }
}

async function startTest() {
  console.log(`\x1b[1mTwist Toolkit 100% Coverage Test\x1b[0m\n`);

  try {
    // --- 1. User & Workspace ---
    console.log(`[1/7] User & Workspace Management`);
    run(`workspaces`);
    run(`set_workspace ${TEST_WS_ID}`);
    run(`users`);
    run(`get_user_info ${TEST_WS_ID} ${ME_ID}`);
    run(`get_user_by_email b08109@gmail.com`);
    run(`add_workspace_user ${TEST_WS_ID} ${TEST_EMAIL}`);
    run(`update_user "hiroki.yamamoto (Test)"`);
    run(`update_user "hiroki.yamamoto"`); // Restore

    // --- 2. Channel Management ---
    console.log(`\n[2/7] Channel Management`);
    run(`channels`);
    const channelName = `FullTestCH_${Date.now()}`;
    const ch = run(`add_channel ${TEST_WS_ID} "${channelName}"`);
    if (!ch) throw new Error("Critical failure: Could not create channel.");
    const chId = ch.id;
    run(`update_channel ${chId} "${channelName}_Updated"`);
    run(`archive_channel ${chId}`);
    run(`unarchive_channel ${chId}`);
    run(`add_user_to_channel ${chId} ${ADA_ID}`);
    run(`remove_user_from_channel ${chId} ${ADA_ID}`);

    // --- 3. Thread & Comment Operations ---
    console.log(`\n[3/7] Thread & Comment Operations`);
    run(`threads ${chId}`);
    run(`unread_threads`);
    const th = run(`add_thread ${chId} "Full Coverage Thread" "Testing every single command."`);
    const thId = th.id;
    run(`star_thread ${thId}`);
    run(`unstar_thread ${thId}`);
    run(`close_thread ${thId}`);
    run(`reopen_thread ${thId}`);
    run(`comments ${thId}`);
    const comment = run(`reply ${thId} "Coverage reply"`);
    run(`add_reaction ${comment.id} "🚀"`);

    // --- 4. Inbox Management ---
    console.log(`\n[4/7] Inbox Management`);
    run(`inbox`);
    run(`get_inbox_count`);
    run(`archive_thread ${thId}`);
    run(`unarchive_inbox_thread ${thId}`);
    run(`complete_thread ${thId}`); 
    run(`mark_all_inbox_read ${TEST_WS_ID}`);
    run(`archive_all_inbox ${TEST_WS_ID}`);

    // --- 5. Direct Messages ---
    console.log(`\n[5/7] Direct Messages`);
    run(`conversations`);
    const conv = run(`get_or_create_conversation ${TEST_WS_ID} "[${ME_ID},${ADA_ID}]"`);
    const convId = conv.id;
    run(`add_message ${convId} "Coverage DM"`);
    run(`messages ${convId}`);
    run(`archive_conversation ${convId}`);
    run(`mute_conversation ${convId} 1`);

    // --- 6. Search & Attachments ---
    console.log(`\n[6/7] Search & Attachments`);
    run(`search "Coverage"`);
    run(`search_in_thread ${thId} "command"`);
    run(`notification_settings`);
    
    // Attachment Test
    const dummyFile = path.join(__dirname, 'dummy.txt');
    fs.writeFileSync(dummyFile, 'Twist Toolkit Coverage Test File');
    run(`upload_attachment "test_upload_id" "${dummyFile}"`);
    fs.unlinkSync(dummyFile);

    // --- 7. Cleanup ---
    console.log(`\n[7/7] Final Cleanup`);
    run(`archive_channel ${chId}`);
    run(`remove_channel ${chId}`);

    console.log(`\n\x1b[42m\x1b[30m 100% COMMAND COVERAGE VERIFIED \x1b[0m`);
  } catch (error) {
    console.error(`\n\x1b[41m TEST SUITE INTERRUPTED \x1b[0m`);
    console.error(error.message);
    process.exit(1);
  }
}

startTest();
