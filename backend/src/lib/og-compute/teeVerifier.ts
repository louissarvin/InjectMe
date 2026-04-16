import { ethers } from 'ethers';

/**
 * Custom TEE Verifier for InjectMe
 *
 * Verifies response signatures against live TEE attestation reports.
 * Handles stale on-chain TargetTeeAddress registrations.
 *
 * Round 3 audit fixes:
 * - H-2: Attestation fetch uses timeout to prevent hanging
 * - M-3: URL parsing uses URL constructor (not fragile string replace)
 * - M-4: All fetches have 5-second timeout via AbortSignal
 */

const FETCH_TIMEOUT_MS = 5000;

interface TeeVerificationResult {
  verified: boolean;
  method: 'attestation_match' | 'sdk_processResponse' | 'failed';
  signerAddress: string;
  attestationAddress: string;
  chatID: string;
  details: string;
}

/** Extract base URL from a proxy URL (removes /v1/proxy suffix safely) */
function getBaseUrl(providerUrl: string): string {
  try {
    const url = new URL(providerUrl);
    // Remove /v1/proxy or /v1/proxy/ from pathname
    url.pathname = url.pathname.replace(/\/v1\/proxy\/?$/, '');
    return url.toString().replace(/\/$/, ''); // Remove trailing slash
  } catch {
    // Fallback: simple replace (M-3 mitigation)
    return providerUrl.replace(/\/v1\/proxy\/?$/, '');
  }
}

/**
 * Verify a chat response was produced inside TEE by checking the signature
 * against the live attestation report.
 */
export async function verifyTeeResponse(
  providerUrl: string,
  model: string,
  chatID: string
): Promise<TeeVerificationResult> {
  const baseUrl = getBaseUrl(providerUrl);

  // Step 1: Fetch the response signature (with timeout)
  let sigText: string;
  let signature: string;
  try {
    const sigRes = await fetch(
      `${baseUrl}/v1/proxy/signature/${chatID}?model=${model}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!sigRes.ok) {
      return {
        verified: false,
        method: 'failed',
        signerAddress: '',
        attestationAddress: '',
        chatID,
        details: `Signature fetch failed: ${sigRes.status} (chatID may have expired)`,
      };
    }
    const sigData = await sigRes.json() as { text: string; signature: string };
    sigText = sigData.text;
    signature = sigData.signature;
  } catch (err) {
    return {
      verified: false,
      method: 'failed',
      signerAddress: '',
      attestationAddress: '',
      chatID,
      details: `Signature fetch error: ${(err as Error).message}`,
    };
  }

  // Step 2: Recover the signer address from the signature
  let recoveredSigner: string;
  try {
    const messageHash = ethers.hashMessage(sigText);
    recoveredSigner = ethers.recoverAddress(messageHash, signature);
  } catch (err) {
    return {
      verified: false,
      method: 'failed',
      signerAddress: '',
      attestationAddress: '',
      chatID,
      details: `Signature recovery failed: ${(err as Error).message}`,
    };
  }

  // Step 3: Fetch the live attestation report (with timeout, H-2 fix)
  let attestationSignerAddress: string;
  try {
    const attRes = await fetch(
      `${baseUrl}/v1/proxy/attestation/report?model=${model}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (!attRes.ok) {
      return {
        verified: false,
        method: 'failed',
        signerAddress: recoveredSigner,
        attestationAddress: '',
        chatID,
        details: `Attestation report fetch failed: ${attRes.status}`,
      };
    }
    const attData = await attRes.json() as { signing_address: string };
    attestationSignerAddress = attData.signing_address;
  } catch (err) {
    return {
      verified: false,
      method: 'failed',
      signerAddress: recoveredSigner,
      attestationAddress: '',
      chatID,
      details: `Attestation fetch error: ${(err as Error).message}`,
    };
  }

  // Step 4: Verify the response signer matches the attestation signer
  const match = recoveredSigner.toLowerCase() === attestationSignerAddress.toLowerCase();

  return {
    verified: match,
    method: match ? 'attestation_match' : 'failed',
    signerAddress: recoveredSigner,
    attestationAddress: attestationSignerAddress,
    chatID,
    details: match
      ? 'Response signature verified against live TEE attestation report'
      : `Signer mismatch: response signed by ${recoveredSigner}, attestation says ${attestationSignerAddress}`,
  };
}
