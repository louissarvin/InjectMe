import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@heroui/react'
import { ChevronDown, Copy, LogOut, User } from 'lucide-react'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useAuth } from '@/hooks/useAuth'
import { useFarcasterContext } from '@/providers/FarcasterProvider'

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export default function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { disconnect } = useDisconnect()
  const [copied, setCopied] = useState(false)
  const { isAuthenticated, login, logout } = useAuth()
  const { isInMiniApp } = useFarcasterContext()

  function handleDisconnect() {
    logout()
    disconnect()
  }

  function handleCopy() {
    navigator.clipboard.writeText(address!).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Farcaster mini-app: bypass RainbowKit modal, connect directly
  if (isInMiniApp && !isConnected) {
    return (
      <Button
        onPress={() => {
          const farcasterConnector = connectors.find(
            (c) => c.id === 'farcaster',
          )
          if (farcasterConnector) connect({ connector: farcasterConnector })
        }}
        className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-150"
        size="sm"
      >
        Connect Wallet
      </Button>
    )
  }

  // Connected but not signed in
  if (isConnected && address && !isAuthenticated) {
    return (
      <Button
        onPress={() =>
          login().catch((err) => console.error('[Auth] Sign-in failed:', err))
        }
        className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-150"
        size="sm"
      >
        Sign In
      </Button>
    )
  }

  // Connected and authenticated
  if (isConnected && address && isAuthenticated) {
    return (
      <Dropdown>
        <DropdownTrigger>
          <button className="flex items-center gap-2 bg-[#F3F4F6] dark:bg-[#1F2937] hover:bg-[#E5E7EB] dark:hover:bg-[#374151] border border-black/[0.08] dark:border-white/[0.08] rounded-full px-4 py-2 text-sm font-medium text-[#0A0B0D] dark:text-[#E5E7EB] transition-colors duration-150">
            <span className="w-2 h-2 rounded-full bg-[#098551] shrink-0" />
            {truncateAddress(address)}
            <ChevronDown size={14} className="text-[#9CA3AF]" />
          </button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label="Wallet options"
          className="bg-white dark:bg-[#141518] border border-black/[0.08] dark:border-[#2D2F36] rounded-2xl min-w-[180px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
        >
          <DropdownItem
            key="profile"
            startContent={<User size={14} />}
            className="text-[#4B5563] dark:text-[#D1D5DB] text-sm"
            as={Link}
            href="/profile"
          >
            Profile
          </DropdownItem>
          <DropdownItem
            key="copy"
            startContent={<Copy size={14} />}
            onPress={handleCopy}
            className="text-[#4B5563] dark:text-[#D1D5DB] text-sm"
          >
            {copied ? 'Copied!' : 'Copy Address'}
          </DropdownItem>
          <DropdownItem
            key="disconnect"
            startContent={<LogOut size={14} />}
            onPress={handleDisconnect}
            className="text-[#CF202F] text-sm"
            color="danger"
          >
            Disconnect
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    )
  }

  // Not connected, not mini-app: use RainbowKit's modal
  return (
    <RainbowConnectButton.Custom>
      {({ openConnectModal }) => (
        <Button
          onPress={openConnectModal}
          className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-150"
          size="sm"
        >
          Connect Wallet
        </Button>
      )}
    </RainbowConnectButton.Custom>
  )
}
