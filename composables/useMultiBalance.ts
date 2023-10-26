import { storeToRefs } from 'pinia'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import { CHAINS, ENDPOINT_MAP, Prefix } from '@kodadot1/static'
import { balanceOf } from '@kodadot1/sub-api'
import format from '@/utils/format/balance'
import { useFiatStore } from '@/stores/fiat'
import { calculateExactUsdFromToken } from '@/utils/calculation'
import { getAssetIdByAccount } from '@/utils/api/bsx/query'
import { toDefaultAddress } from '@/utils/account'

import { useIdentityStore } from '@/stores/identity'
import type { PalletBalancesAccountData } from '@polkadot/types/lookup'

const networkToPrefix = {
  polkadot: 'dot',
  kusama: 'ksm',
  basilisk: 'bsx',
  kusamaHub: 'ahk',
  'basilisk-testnet': 'snek',
  polkadotHub: 'ahp',
}

const prefixToNetwork = {
  dot: 'polkadot',
  rmrk: 'kusama',
  ksm: 'kusama',
  bsx: 'basilisk',
  ahk: 'kusamaHub',
  snek: 'basilisk-testnet',
  ahp: 'polkadotHub',
}

const getNetwork = (prefix: Prefix) => {
  return prefixToNetwork[prefix]
}

function calculateUsd(amount: string, tokenValue) {
  if (!amount) {
    return 0
  }

  const amountToNumber = Number(amount.replace(/\,/g, ''))

  return calculateExactUsdFromToken(amountToNumber, Number(tokenValue))
}

export default function () {
  const fiatStore = useFiatStore()
  const { isTestnet } = usePrefix()
  const identityStore = useIdentityStore()
  const { accountId } = useAuth()

  const { multiBalanceAssets, multiBalanceAssetsTestnet } =
    storeToRefs(identityStore)

  const currentNetwork = computed(() =>
    isTestnet.value ? 'test-network' : 'main-network',
  )

  async function getBalance(chainName: string, token = 'KSM', tokenId = 0) {
    const currentAddress = accountId.value
    const prefix = networkToPrefix[chainName]
    const chain = CHAINS[prefix]

    const defaultAddress = toDefaultAddress(currentAddress)
    const publicKey = decodeAddress(currentAddress)
    const prefixAddress = encodeAddress(publicKey, chain.ss58Format)
    const wsProvider = new WsProvider(ENDPOINT_MAP[prefix])

    const api = await ApiPromise.create({
      provider: wsProvider,
    })

    let currentBalance
    let nativeBalance

    if (tokenId) {
      nativeBalance = (
        (await api.query.tokens.accounts(
          prefixAddress,
          tokenId,
        )) as PalletBalancesAccountData
      ).free.toString()
      currentBalance = format(nativeBalance, chain.tokenDecimals, false)
    } else {
      nativeBalance = await balanceOf(api, prefixAddress)
      currentBalance = format(nativeBalance, chain.tokenDecimals, false)
    }

    let selectedTokenId = String(tokenId)
    if (chainName === 'basilisk') {
      selectedTokenId = await getAssetIdByAccount(api, prefixAddress)
    }

    const usd = calculateUsd(
      currentBalance,
      fiatStore.getCurrentTokenValue(token),
    )

    identityStore.setMultiBalances({
      address: defaultAddress,
      chains: {
        [chainName]: {
          [token.toLowerCase()]: {
            address: prefixAddress,
            balance: currentBalance,
            nativeBalance,
            usd,
            selected: selectedTokenId === String(tokenId),
          },
        },
      },
      chainName,
    })

    identityStore.multiBalanceNetwork = currentNetwork.value

    await wsProvider.disconnect()
  }

  const fetchFiatPrice = async (force) => {
    if (!force && fiatStore.incompleteFiatValues) {
      await fiatStore.fetchFiatPrice()
    }
  }

  const fetchMultipleBalance = async (
    onlyPrefixes: Prefix[] = [],
    forceFiat: boolean = false,
  ) => {
    await fetchFiatPrice(forceFiat)

    const assets = isTestnet.value
      ? multiBalanceAssetsTestnet.value
      : multiBalanceAssets.value

    const chainNetworks = onlyPrefixes.map(getNetwork).filter(Boolean)

    const assetsToFetch = onlyPrefixes.length
      ? assets.filter((item) => chainNetworks.includes(item.chain))
      : assets

    const promisses = await assetsToFetch.map((item) =>
      getBalance(item.chain, item.token, Number(item.tokenId)),
    )

    return Promise.allSettled(promisses)
  }

  return {
    fetchMultipleBalance,
    currentNetwork,
  }
}
