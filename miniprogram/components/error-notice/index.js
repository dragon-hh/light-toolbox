const session = require('../../utils/tool-session');
Component({
  properties: { message: String, info: Object, retryText: String, disabled: Boolean },
  data: { expanded: false },
  observers: { 'message,info': function() { this.setData({ expanded: false }); } },
  methods: {
    retry() { if (!this.data.disabled) this.triggerEvent('retry'); },
    toggleDetails() { this.setData({ expanded: !this.data.expanded }); },
    purchase() { session.openMember(this.data.info.returnTo); }
  }
});
