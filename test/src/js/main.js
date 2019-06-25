let localVariable = 5;
window.thing = localVariable * 5;

console.log("Hello!"); // This should be sanitized, so that the </script> tag doesn't get exited out