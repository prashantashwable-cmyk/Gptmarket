import { core } from './mr/core';
import { enums } from './mr/enums';
import { app } from './mr/app';
import { market } from './mr/market';
import type { Messages } from '../index';

export const mr: Messages = {
  ...core, e: { ...enums, ...market.e, role: { ...enums.role, ...market.role } }, ...app,
  err: { ...core.err, ...market.err }, n: { ...app.n, ...market.n }, nav: { ...app.nav, ...market.nav }, og: { ...app.og, ...market.og }, mk: market.mk,
};
