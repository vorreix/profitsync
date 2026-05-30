// Simulating the serialize function behavior
function serialize(row) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/([A-Z])/g, "_$1").toLowerCase(),
      v,
    ])
  )
}

// Test what happens when row is undefined
try {
  const result = serialize(undefined)
  console.log("Result:", result)
} catch (e) {
  console.log("Error name:", e.name)
  console.log("Error message:", e.message)
  console.log("Error type:", typeof e)
}
