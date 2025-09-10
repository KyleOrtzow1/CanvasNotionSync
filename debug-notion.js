// Debug script to test Notion API connection
// Open browser dev tools (F12) and paste this in the console

async function debugNotionConnection(token, databaseId) {
  console.log('🔍 Starting Notion API Debug...');
  console.log('Token (first 20 chars):', token.substring(0, 20) + '...');
  console.log('Database ID:', databaseId);
  console.log('Database ID length:', databaseId.length);
  
  // Validate token format
  if (!token.startsWith('secret_') && !token.startsWith('ntn_')) {
    console.error('❌ Invalid token format. Should start with "secret_" or "ntn_"');
    return;
  }
  
  // Validate database ID format
  const cleanDbId = databaseId.replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/i.test(cleanDbId)) {
    console.error('❌ Invalid database ID format. Should be 32 hex characters');
    console.log('Cleaned ID:', cleanDbId);
    console.log('Cleaned ID length:', cleanDbId.length);
    return;
  }
  
  console.log('✅ Format validation passed');
  
  // Test 1: Basic database query
  console.log('\n🧪 Test 1: Basic database query');
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({})
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Response body:', responseText);
    
    if (response.ok) {
      const data = JSON.parse(responseText);
      console.log('✅ Test 1 passed! Database accessible');
      console.log('Database info:', {
        title: data.results?.[0]?.parent?.database_id || 'No results',
        resultCount: data.results?.length || 0
      });
    } else {
      console.error('❌ Test 1 failed');
      if (response.status === 404) {
        console.error('404 Error: Database not found or integration not shared');
      }
    }
  } catch (error) {
    console.error('❌ Test 1 error:', error);
  }
  
  // Test 2: Get database schema
  console.log('\n🧪 Test 2: Get database schema');
  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28'
      }
    });
    
    console.log('Schema response status:', response.status);
    
    if (response.ok) {
      const schema = await response.json();
      console.log('✅ Test 2 passed! Database schema retrieved');
      console.log('Database title:', schema.title?.[0]?.text?.content || 'No title');
      console.log('Properties:', Object.keys(schema.properties || {}));
    } else {
      const errorText = await response.text();
      console.error('❌ Test 2 failed:', response.status, errorText);
    }
  } catch (error) {
    console.error('❌ Test 2 error:', error);
  }
}

// Quick test function
async function quickDebug() {
  // Get values from popup if available
  const tokenInput = document.getElementById('notionToken');
  const dbInput = document.getElementById('notionDatabase');
  
  if (tokenInput && dbInput) {
    const token = tokenInput.value.trim();
    const dbId = dbInput.value.trim();
    
    if (token && dbId) {
      await debugNotionConnection(token, dbId);
    } else {
      console.log('Please enter token and database ID in the popup first');
    }
  } else {
    console.log('Please run this in the extension popup or provide credentials manually');
    console.log('Usage: debugNotionConnection("your_token", "your_database_id")');
  }
}

console.log('🚀 Debug utilities loaded!');
console.log('Run quickDebug() to test current popup values');
console.log('Or run debugNotionConnection("token", "database_id") manually');
