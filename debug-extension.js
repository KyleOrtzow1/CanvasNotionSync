// Debug script for extension popup console
// Open extension popup → F12 → Console → paste this

async function debugExtensionConnection() {
  console.log('🔍 Debug: Extension Notion Connection');
  
  // Get values from popup
  const tokenInput = document.getElementById('notionToken');
  const dbInput = document.getElementById('notionDatabase');
  
  if (!tokenInput || !dbInput) {
    console.error('❌ Could not find input fields. Make sure you are in the extension popup.');
    return;
  }
  
  const token = tokenInput.value.trim();
  const dbId = dbInput.value.trim().replace(/-/g, '');
  
  console.log('Token (first 20 chars):', token.substring(0, 20) + '...');
  console.log('Database ID:', dbId);
  console.log('Database ID length:', dbId.length);
  
  if (!token || !dbId) {
    console.error('❌ Please enter token and database ID first');
    return;
  }
  
  try {
    console.log('🧪 Testing via background script...');
    
    const result = await chrome.runtime.sendMessage({
      action: 'TEST_NOTION_CONNECTION',
      token: token,
      databaseId: dbId
    });
    
    console.log('Background script result:', result);
    
    if (result.success) {
      console.log('✅ SUCCESS: Connection works!');
    } else {
      console.log('❌ FAILED:', result.error);
      
      if (result.error.includes('404')) {
        console.log('💡 404 means either:');
        console.log('   • Database ID is wrong');
        console.log('   • Integration not shared with database');
        console.log('   • Database was deleted');
      }
    }
    
  } catch (error) {
    console.error('❌ Extension error:', error);
  }
}

// Also test direct fetch (will fail due to CORS but shows different error)
async function testDirectFetch() {
  const token = document.getElementById('notionToken').value.trim();
  const dbId = document.getElementById('notionDatabase').value.trim().replace(/-/g, '');
  
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({})
    });
    
    console.log('Direct fetch result:', response);
  } catch (error) {
    console.log('Direct fetch error (expected CORS):', error);
  }
}

console.log('🚀 Debug utilities loaded!');
console.log('Run: debugExtensionConnection()');
console.log('Or: testDirectFetch()');
