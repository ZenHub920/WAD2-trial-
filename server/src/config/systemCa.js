import tls from 'node:tls';

/** Explicit opt-in for networks using an OS-trusted corporate/institution CA. */
export function configureSystemCa({ env = process.env, tlsApi = tls } = {}) {
  if (env.ENCORE_USE_SYSTEM_CA !== 'true') return false;
  if (typeof tlsApi.getCACertificates !== 'function' || typeof tlsApi.setDefaultCACertificates !== 'function')
    throw new Error('system_ca_requires_supported_node_version');
  // Keep bundled/default trust and add only roots already trusted by the OS.
  // Never disable certificate or hostname verification or accept arbitrary PEMs.
  const certificates = [...new Set([...tlsApi.getCACertificates('default'), ...tlsApi.getCACertificates('system')])];
  tlsApi.setDefaultCACertificates(certificates);
  return true;
}
