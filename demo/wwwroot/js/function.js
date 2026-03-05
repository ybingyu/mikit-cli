const app = new Vue({
    el: '#app',
    data: {
        // 这个变量在程序包里app.js
        user: {
            user_type: 1,//新
        },
        picURL: 'pic/',
        // picURL: 'https://img8.99.com/my/activity/2025/12/wb/',
        rewardsList: [
            // 0-老玩家 5
            [
                {
                    name: '<span>1000元京东E卡</span>',
                    pic: 'p1'
                }, {
                    name: '<span>500元京东E卡</span>',
                    pic: 'p2'
                }, {
                    name: '<span>华丽星石礼袋[绑]</span>',
                    pic: 'p3'
                }, {
                    name: '<span>耀阳洗炼石[绑]</span>',
                    pic: 'p4'
                }, {
                    name: '<span>100级神火碎晶[绑]</span>',
                    pic: 'p5'
                },
            ],
            // 1-新玩家 6
            [
                {
                    name: '<span>20周年纪念金钞</span>',
                    pic: 'p10'
                }, 
                {
                    name: '<span><b>Ⅱ</b>阶白品宝石匣[绑]</span>',
                    pic: 'p6'
                },  {
                    name: '<span>100级神火碎晶[绑]</span>',
                    pic: 'p5'
                }, {
                    name: '<span>20周年庆缰绳包[绑]</span>',
                    pic: 'p8',
                    cls:'js'
                },{
                    name: '<span>祈灵原石·耀阳[绑]</span>',
                    pic: 'p7'
                }, {
                    name: '<span>梦幻星石礼盒[绑]</span>',
                    pic: 'p9'
                }
            ]
        ],
        goodsList: [
            {
                name: '<span>耀阳洗炼石[绑]</span>',
                pic: 'g1',
                count: 9
            }, {
                name: '<span>曜日碎晶宝箱[绑]</span>',
                pic: 'g2',
                count: 2
            }, {
                name: '<span>超能神火结晶[绑]</span>',
                pic: 'g3'
            }, {
                name: '<span>祈灵圣石·耀阳[绑]</span>',
                pic: 'g4'
            },
        ],


        popMsg: '',
        address: {
            province: '省',
            city: '市',
            area: '区'
        },

        btnLuckStatus: 0,// 展示用：开启好运-今日已开启-已达上限
        btnDiscountStatus: 0,// 展示用：可领取-已购买

        isAni: false,
        orderWay: 0,// 选择支付方式
        
        // 抽奖相关属性
        current: -1,
        lastLottery: -1,
        random: -1,
        speed: 100,
        times: 0,
        cycle: 5,
        prize: -1,
        timer: null,
        isLottery: true,
        count: 0
    },
    components: {
        VDistpicker: VDistpicker
    },

    mounted: function () {
        this.init();

        /*test:展示*/
        if (!!myPublic.getQueryString('pop')) {
            for (let key in this.$refs) {
                this.$refs[key].classList.add('active');
            }

            this.popShowCommon('通用')
        }

        this.user.user_type = Number(myPublic.getQueryString('o')) || 0
        console.log(this.user.user_type ? '新玩家' : '老玩家')
        // console.log('Updated JS file')
        /*test:end*/

        setTimeout(() => { this.isAni = true }, 100)
    },
    methods: {
        init: function () {
            const that = this;
            that.popClose();
        },

        //选择收货地址
        onSelected: function (data) {
            this.address.province = data.province.value;
            this.address.city = data.city.value;
            this.address.area = data.area.value;
        },
        //弹窗显示
        popHandler: function (pop, isClose, msg) {
            if (isClose) {
                this.$refs[pop].classList.remove('active');
            } else {
                if (msg) this.msg = msg
                this.$refs[pop].classList.add('active');
            }
        },
        // 通用弹窗
        popShowCommon(str) {
            this.popMsg = str
            this.popHandler('popMsg')
        },
        //弹窗关闭
        popClose: function () {
            document.querySelector('body').addEventListener('click', function (e) {
                if (e.target.classList.contains('pop-close')) {
                    e.target.closest('.pop-box').classList.remove('active')
                }
            });
        },
        
        // 抽奖
        move() {
            const that = this;
            if (!that.isLottery) {
                return;
            }
            that.current = -1;
            that.lastLottery = -1;
            // 优化随机数生成方式
            const listLength = this.rewardsList[this.user.user_type].length;
            // 使用更可靠的随机数生成方式，移除可能导致问题的位运算
            that.random = Math.floor(Math.random() * listLength);
            // 确保随机数在有效范围内
            that.random = Math.max(0, Math.min(listLength - 1, that.random));
            console.log('随机数生成:', that.random, '列表长度:', listLength, '用户类型:', this.user.user_type)

            
            that.start();
        },
        
        roll() {
            this.count = this.rewardsList[this.user.user_type].length;
            let index = this.current;
            let count = this.count;
            index += 1;
            if (index > count - 1) {
                index = 0;
            }
            this.current = index;
            return false;
        },
        
        start() {
            const self = this;
            self.speed = 100;
            self.times += 1;
            self.isLottery = false;
            self.roll();
            if (self.times > self.cycle + 10 && self.prize === self.current) { //结束
                clearTimeout(self.timer);
                self.current = -1;
                self.prize = -1;
                self.times = 0;
                self.isLottery = true;
                self.lastLottery = self.random; //确定奖品的位置，用来显示奖品
                self.popShowCommon('恭喜您获得了' + self.rewardsList[self.user.user_type][self.lastLottery].name);
            } else {
                if (self.times < self.cycle) {
                    self.speed -= 10;
                } else if (self.times === self.cycle) {
                    self.prize = self.random;
                } else {
                    if (self.times > self.cycle + 10 && (self.prize === self.current + 1)) {
                        self.speed += 110;
                    } else {
                        self.speed += 50;
                    }
                }
                if (self.speed < 40) {
                    self.speed = 40;
                }
                self.timer = setTimeout(self.start, self.speed);
            }
            return false;
        }
    }
});
