import { DomesticProvider } from './domestic-provider.mjs';
// Old configuration remains callable, but cannot launch the legacy system-temp/maker reader.
export class DfrobotPublicProvider extends DomesticProvider {
  constructor(packageRoot) { super({ packageRoot }); }
}
