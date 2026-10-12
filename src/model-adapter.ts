import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

/** Keep legacy IDs resolvable internally, but never list them in the picker. */
export class AntigravityAdapter extends PiAiAdapter {
  constructor(options: ConstructorParameters<typeof PiAiAdapter>[0], private readonly visibleIds: () => ReadonlySet<string>) { super(options) }

  override async listModels(provider: string) {
    const models = await super.listModels(provider)
    const ids = this.visibleIds()
    return models.filter((model) => ids.has(model.id))
  }
}
