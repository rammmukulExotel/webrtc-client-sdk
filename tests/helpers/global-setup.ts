import * as dotenv from 'dotenv';
import * as path from 'path';
import { loadSipConfig, getMode, hasIcoreConfig } from './env';
import { syncSipEnvFromIcore } from './icore';

export default async function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  try {
    if (hasIcoreConfig()) {
      const m = await syncSipEnvFromIcore();
      // eslint-disable-next-line no-console
      console.log(
        `[parity] synced SIP from icore usermapping user_id=${m?.userId} sip=${m?.sipUserName}`
      );
    }
    const sip = loadSipConfig();
    // eslint-disable-next-line no-console
    console.log(
      `[parity] mode=${getMode()} user=${sip.userName} domain=${sip.sipdomain} host=${sip.host}:${sip.port}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(msg);
    throw e;
  }
}
