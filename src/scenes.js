// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is the quota above 90 %?" is already a scene condition on the device
// features, for the users added to Gladys. The reading action is about what a
// condition cannot do: put the state in a message ("scanner: quota 42 % used,
// last file /scans/invoice.pdf on 22/10 08:12"). It reads SFTPGo again when
// the last read is older than 15 seconds.
// -----------------------------------------------------------------------------

import { quotaPercent } from './devices.js';
import { SENTENCE_TEXT, formatBytes, formatTime, labelled } from './texts.js';

export const SCENE_ACTIONS = {
  async get_user_status(hub, { fields = {} }) {
    const user = await hub.userOf(fields.device);
    const language = hub.config.language;
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    const context = hub.userContext(user.username);
    const percent = quotaPercent(user);
    const last = context.last;
    const lastTime = last ? formatTime(last.time, language) : '';
    const parts = [
      percent === null ? words.noQuota : words.quota(percent),
      last ? words.lastUpload(last.path, lastTime) : words.noUpload,
    ];
    return {
      user: user.username,
      quota_percent: percent ?? -1,
      used_size: user.quotaTracked ? formatBytes(user.usedSize) : '',
      files: user.quotaTracked ? user.usedFiles : -1,
      connections: context.connections.filter((c) => c.username === user.username).length,
      uploads_today: context.eventLog ? context.uploadsToday : -1,
      last_upload: last?.path ?? '',
      last_upload_time: lastTime,
      sentence: `${labelled(user.username, parts.join(', '), language)}.`,
    };
  },
};
