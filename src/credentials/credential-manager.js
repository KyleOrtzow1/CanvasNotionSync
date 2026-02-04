// Encrypted storage and credential management
export class CredentialManager {
  static async generateEncryptionKey() {
    // Try to get existing key from storage
    const { encryptionKey } = await chrome.storage.local.get(['encryptionKey']);

    if (encryptionKey) {
      // Import the existing key
      return await crypto.subtle.importKey(
        'raw',
        new Uint8Array(encryptionKey),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      // Generate a new key
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // Export and store the key
      const exportedKey = await crypto.subtle.exportKey('raw', key);
      await chrome.storage.local.set({
        encryptionKey: Array.from(new Uint8Array(exportedKey))
      });

      return key;
    }
  }

  static async encryptData(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedData = new TextEncoder().encode(JSON.stringify(data));

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encodedData
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return Array.from(combined);
  }

  static async decryptData(encryptedArray, key) {
    const combined = new Uint8Array(encryptedArray);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    const decodedData = new TextDecoder().decode(decrypted);
    return JSON.parse(decodedData);
  }

  static async storeCredentials(canvasToken, notionToken, notionDatabaseId) {
    try {
      const key = await this.generateEncryptionKey();
      
      // Prepare credential data
      const credentials = {
        canvasToken: canvasToken || null,
        notionToken: notionToken || null,
        notionDatabaseId: notionDatabaseId || null
      };
      
      // Encrypt the credentials
      const encryptedCredentials = await this.encryptData(credentials, key);
      
      // Store encrypted data and metadata
      await chrome.storage.local.set({
        encryptedCredentials: encryptedCredentials,
        lastSync: Date.now(),
        credentialsVersion: '1.0' // For future migration support
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  static async getCredentials() {
    try {
      const { encryptedCredentials, lastSync } = await chrome.storage.local.get(['encryptedCredentials', 'lastSync']);
      
      if (encryptedCredentials) {
        // Decrypt the stored credentials
        const key = await this.generateEncryptionKey();
        const credentials = await this.decryptData(encryptedCredentials, key);
        
        // Add lastSync to the result
        return {
          ...credentials,
          lastSync: lastSync
        };
      } else {
        // Try legacy unencrypted storage for migration
        const legacyResult = await chrome.storage.local.get(['canvasToken', 'notionToken', 'notionDatabaseId', 'lastSync']);

        if (legacyResult.canvasToken || legacyResult.notionToken || legacyResult.notionDatabaseId) {
          // Migrate to encrypted storage
          await this.storeCredentials(
            legacyResult.canvasToken,
            legacyResult.notionToken,
            legacyResult.notionDatabaseId
          );
          
          // Remove legacy credentials
          await chrome.storage.local.remove(['canvasToken', 'notionToken', 'notionDatabaseId']);
          
          return legacyResult;
        }
        
        return {};
      }
    } catch (error) {
      // If decryption fails, try legacy storage
      try {
        const legacyResult = await chrome.storage.local.get(['canvasToken', 'notionToken', 'notionDatabaseId', 'lastSync']);
        return legacyResult;
      } catch (legacyError) {
        return {};
      }
    }
  }

  static async clearAllData() {
    try {
      await chrome.storage.local.clear();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}