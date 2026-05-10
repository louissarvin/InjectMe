import { vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    [key: string]: unknown
  }) => {
    const href =
      params && to.includes('$')
        ? to.replace(/\$(\w+)/g, (_: string, key: string) => params[key] ?? '')
        : to

    const { className, ...htmlAttrs } = rest
    return (
      <a
        href={href}
        className={rest.className as string}
        data-testid="router-link"
        {...htmlAttrs}
      >
        {children}
      </a>
    )
  },
  createFileRoute: () => () => ({}),
}))
