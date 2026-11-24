import { core } from './hi/core';
import { enums } from './hi/enums';
import { app } from './hi/app';
import { market } from './hi/market';
import type { Messages } from '../index';

export const hi: Messages = {
  ...core, e: { ...enums, ...market.e, role: { ...enums.role, ...market.role } }, ...app,
  err: { ...core.err, ...market.err }, n: { ...app.n, ...market.n }, nav: { ...app.nav, ...market.nav }, mk: market.mk,
};
