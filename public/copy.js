var codes = document.querySelectorAll('.highlight');
codes.forEach(function (code) {
  var pre = code.querySelector('pre');
  var button = document.createElement('button');
  var i = document.createElement('i');
  i.className = 'far fa-clipboard';
  button.appendChild(i);
  button.className = 'copy-button';
  var button_div = document.createElement('div');
  button_div.className = 'copy-button-wrap'
  button_div.appendChild(button)
  pre.prepend(button_div)
})
var copyCode = new ClipboardJS('.copy-button', {
    target: function(trigger) {
        var code = trigger.parentElement.nextElementSibling;
        var spans = code.querySelectorAll('.ln');
        for (let span of spans) {
          span.style.visibility = 'hidden'
        }
        return code;
    }
});
copyCode.on('success', function(event) {
    event.clearSelection();
    var code = event.trigger.parentElement.nextElementSibling;
    var spans = code.querySelectorAll('code > .ln');
    for (let span of spans) {
      span.style.visibility = 'visible';
    }
    event.trigger.querySelector('i').className = 'fas fa-clipboard-check';
    window.setTimeout(function() {
        event.trigger.querySelector('i').className = 'far fa-clipboard';
    }, 2000);
});
copyCode.on('error', function(event) {});