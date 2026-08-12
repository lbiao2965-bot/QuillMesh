export interface CommandDefinition {
  id: string
  label: () => string
  keywords?: () => string[]
  shortcut?: string
  enabled?: () => boolean
  execute: () => void | Promise<void>
}

/** A single source of truth for menus, the palette, slash insertion, and context actions. */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>()

  register(command: CommandDefinition): this {
    this.commands.set(command.id, command)
    return this
  }

  get(id: string): CommandDefinition | undefined { return this.commands.get(id) }

  list(query = ''): CommandDefinition[] {
    const needle = query.trim().toLocaleLowerCase()
    return [...this.commands.values()].filter((command) => {
      if (command.enabled && !command.enabled()) return false
      if (!needle) return true
      return [command.label(), ...(command.keywords?.() ?? []), command.id].join(' ').toLocaleLowerCase().includes(needle)
    })
  }

  execute(id: string): boolean {
    const command = this.commands.get(id)
    if (!command || (command.enabled && !command.enabled())) return false
    void command.execute()
    return true
  }
}
