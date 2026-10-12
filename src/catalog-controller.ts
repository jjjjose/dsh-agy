import type { CatalogIdentity, ModelCatalog } from './catalog.ts'
import { CATALOG_REFRESH_MS } from './catalog.ts'
import type { RequestAuth } from './api.ts'

interface Accounts {
  catalogIdentity(): Promise<CatalogIdentity | undefined>
  catalogIdentities(): Promise<CatalogIdentity[]>
  catalogAuth(identity: CatalogIdentity): Promise<RequestAuth>
}

/** Only the latest account selection can publish or report refresh failures. */
export class CatalogController {
  private revision = 0
  private disposed = false
  private timer?: ReturnType<typeof setInterval>
  constructor(private readonly catalog: ModelCatalog, private readonly accounts: Accounts) {}

  start(): void {
    if (this.timer || this.disposed) return
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, CATALOG_REFRESH_MS)
  }

  async refresh(): Promise<void> {
    if (this.disposed) return
    const revision = ++this.revision
    const current = () => !this.disposed && revision === this.revision
    try {
      const [identity, identities] = await Promise.all([this.accounts.catalogIdentity(), this.accounts.catalogIdentities()])
      if (!current()) return
      await this.catalog.retain(identities)
      if (!current()) return
      await this.catalog.activate(identity)
      if (!identity || !current()) return
      const auth = await this.accounts.catalogAuth(identity)
      if (!current()) return
      await this.catalog.get(auth, true)
    } catch {
      if (current()) this.catalog.failure()
    }
  }

  dispose(): void { this.disposed = true; this.revision++; clearInterval(this.timer); this.catalog.dispose() }
}
