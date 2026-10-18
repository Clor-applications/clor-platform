import { pullHikvision } from './hikvision.js';
import { pullDahua } from './dahua.js';
import { pullBiostar } from './biostar.js';
import { pullHttp } from './httpPull.js';
import { pullAnviz } from './anviz.js';
import type { PullContext, PullResult } from './common.js';

/** The driver for a vendor, given a context with the credentials already in the clear. Shared by the cloud and the on-site connector. */
export async function pullByVendor(vendor: string, ctx: PullContext): Promise<PullResult> {
  switch (vendor) {
    case 'HIKVISION':
      return pullHikvision(ctx);
    case 'DAHUA':
      return pullDahua(ctx);
    case 'BIOSTAR':
      return pullBiostar(ctx);
    case 'HTTP_PULL':
      return pullHttp(ctx);
    case 'ANVIZ_CLOUD':
      return pullAnviz(ctx);
    default:
      return { ok: false, message: `${vendor} has no pull driver.`, lines: [], received: 0 };
  }
}
