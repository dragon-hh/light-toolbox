Component({
  data: { selected: 0, tabs: [{ url: '/pages/home/index', text: '工具箱' }, { url: '/pages/records/index', text: '使用记录' }, { url: '/pages/member/index', text: '我的' }] },
  methods: { switchTab(event) { wx.switchTab({ url: this.data.tabs[event.currentTarget.dataset.index].url }); } }
});
