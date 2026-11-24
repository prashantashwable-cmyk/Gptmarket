import { core } from './en/core';
import { enums } from './en/enums';
import { app } from './en/app';
import { market } from './en/market';
import { store } from './en/store';

export const en = {
  ...core, e: { ...enums, ...market.e, role: { ...enums.role, ...market.role } }, ...app,
  err: { ...core.err, ...market.err }, n: { ...app.n, ...market.n }, nav: { ...app.nav, ...market.nav }, og: { ...app.og, ...market.og }, mk: market.mk, store,
};
