"use client";

import { useState, useEffect } from "react";
import { Sparkles, Loader2, BookOpen, ChevronRight, Save, X, Edit, Plus, Trash2, Layout, User, Zap, Box, Map, UserPlus, Users, MessageSquare, RotateCcw, ChevronDown, LayoutGrid, List as ListIcon, MoreHorizontal, ArrowRight, ArrowLeft, Check, Settings2, FileText, Layers } from "lucide-react";
import { GeneratedVolume, GeneratedDetailedOutline, GeneratedCharacterInfo, GlobalPlan } from "../../lib/ai/outlineGenerator";
import { createNovelProject, updateNovelProject, getActiveNovelProject, type VolumeOutline, type ChapterOutline, type NovelProject, type Character } from "../../lib/novelProjects";
import { useRouter } from "next/navigation";
import { Toaster, toast } from 'sonner';
import GeneratingOverlay from "../../components/GeneratingOverlay";

type Step = 1 | 2 | 3;

const narrativeStructures = [
  { value: "standard", label: "标准三幕式", desc: "起承转合、经典叙事，适用都市/玄幻/言情" },
  { value: "hero_journey", label: "英雄之旅", desc: "跨越门槛→遇见盟友→终极考验，适用玄幻/西幻/系统流" },
  { value: "fast_paced", label: "快节奏爽文", desc: "开篇冲突→金手指→循环打脸，适用都市系统/赘婿/战神" },
  { value: "mystery", label: "悬疑解谜", desc: "抛出谜题→烟雾弹→真相大白，适用刑侦/灵异/无限流" },
  { value: "tragedy", label: "悲剧内核", desc: "美好撕裂→命运不公→遗憾收尾，适用虐恋/权谋/暗黑奇幻" },
  { value: "infinite_loop", label: "无限流循环", desc: "副本迭代→规则杀→记忆重置，适用无限流/恐怖/科幻生存" },
  { value: "multi_thread", label: "多线并进", desc: "视角切换→伏笔回收→高潮汇合，适用群像/权谋/史诗玄幻" },
  { value: "flashback", label: "倒叙+插叙", desc: "结局前置→悬念钩子→回忆补全，适用悬疑/复仇/传记" },
  { value: "episodic", label: "单元剧+主线", desc: "单元故事→主线伏笔→逐步揭秘，适用都市灵异/侦探/系统流" },
  { value: "counterattack", label: "逆袭爽点流", desc: "低谷开局→扮猪吃虎→越级反杀，适用赘婿/战神/废柴流" },
];

const outlineTemplates = [
  { 
    id: "xianxia", 
    label: "仙侠修炼", 
    icon: "🧧",
    description: "灵根觉醒、境界突破、宗门大比、秘境探险",
    core: "废柴逆袭→觉醒逆天灵根→宗门内卷打脸→秘境夺宝→证道成仙",
    tags: "仙侠,修炼,玄幻,凡人流",
    example: "主角叶凡本是世俗少年，因缘际会之下觉醒了变异冰灵根，被带入青云宗外门。他身怀上古残缺功法，修炼速度远超同龄人，却被宗门天才视为眼中钉。一次秘境试炼中，他意外获得上古修士传承从此开启了逆天改命之路。\n\n核心冲突：\n1. 修炼资源匮乏，需要不断争夺\n2. 宗门内斗，被迫站队\n3. 上古势力苏醒，掀起修仙界动荡\n\n金手指：上古功法残篇，每次突破都能领悟神通"
  },
  { 
    id: "urban", 
    label: "都市生活", 
    icon: "🏙️",
    description: "职场商战、豪门恩怨、特种兵王、透视赌石",
    core: "底层打工人→获得金手指→商场/情场逆袭→手撕仇人→登顶都市之巅",
    tags: "都市,豪门,爽文,神豪",
    example: "穷小子陈风意外获得家传玉佩传承，觉醒透视能力。赌石、鉴宝、医术、泡妞样样精通。从一个小小的古玩店老板，逐步建立起庞大的商业帝国。\n\n核心冲突：\n1. 豪门世家的打压与拉拢\n2. 地下势力的威胁\n3. 各路强者的挑战\n\n金手指：透视眼+家传功法"
  },
  { 
    id: "system", 
    label: "系统流", 
    icon: "💻",
    description: "游戏系统、选择变强、任务副本、道具商城",
    core: "绑定系统→完成任务获奖励→选择分支剧情→兑换神级道具→碾压对手",
    tags: "系统,都市,玄幻,诸天",
    example: "普通大学生林浩在失恋当天被宇宙最强系统选中，只要完成系统任务就能获得各种超能力。从最强武力到无上医术，从财富到寿命，全部都能兑换。\n\n核心冲突：\n1. 系统任务的难度与惩罚\n2. 其他宿主带来的威胁\n3. 逐渐揭开系统背后的真相\n\n金手指：最强超神系统"
  },
  { 
    id: "reborn", 
    label: "重生逆袭", 
    icon: "⏰",
    description: "回到过去、弥补遗憾、预知未来、复仇打脸",
    core: "带着前世记忆重生→避开前世坑→提前布局→报复仇人→守护亲友",
    tags: "重生,都市,修仙,年代",
    example: "顶级富豪张铭重生回到2008年高考前夕。前世他白手起家创千亿帝国，却被最信任的人害死。这一世他要弥补所有遗憾，让那些背叛者付出代价。\n\n核心冲突：\n1. 阻止父母离婚，保住完整家庭\n2. 抢占前世商业先机\n3. 报复前世的仇人\n\n金手指：未来记忆"
  },
  { 
    id: "game", 
    label: "游戏异界", 
    icon: "🎮",
    description: "全息游戏、虚拟世界、NPC觉醒、装备技能",
    core: "进入全息游戏→成为职业玩家→攻略副本→觉醒NPC意识→打破次元壁",
    tags: "游戏,虚拟,穿越,网游",
    example: "全球首款脑波接入游戏《神域》开服，玩家林羽进入游戏后发现自己变成了NPC。他拥有独立意识，能自主升级刷怪，成为游戏世界的一方霸主。\n\n核心冲突：\n1. 玩家与NPC的矛盾\n2. 游戏与现实的连接\n3. 背后开发公司的阴谋\n\n金手指：NPC觉醒+无限可能"
  },
  { 
    id: "horror", 
    label: "悬疑灵异", 
    icon: "👻",
    description: "恐怖直播、规则怪谈、灵异事件、密室逃脱",
    core: "卷入规则怪谈→破解死亡谜题→直播闯关→揭露幕后邪祟→存活通关",
    tags: "灵异,恐怖,无限,规则",
    example: "陈默一觉醒来发现自己身处一栋诡秘的大楼中，唯一的出路是遵守规则并完成游戏。每层楼都有不同的死亡规则，只有找到规律才能活下去。\n\n核心冲突：\n1. 各种诡异的死亡规则\n2. 其他玩家的勾心斗角\n3. 隐藏在背后的组织\n\n金手指：过目不忘+冷静分析"
  },
  { 
    id: "military", 
    label: "都市军文", 
    icon: "⚔️",
    description: "特种兵王、保家卫国、单兵无敌、雇佣兵界",
    core: "退役兵王→回归都市→保护亲友→对抗境外势力→为国征战",
    tags: "兵王,都市,军事,安保",
    example: "代号【青龙】的特种兵王萧龙完成任务后退役回归都市。然而平静的生活被打破，各方势力纷纷登场，他不得不重披战袍守护家人。\n\n核心冲突：\n1. 雇佣兵组织的报复\n2. 地下世界的挑战\n3. 隐藏的国籍危机\n\n金手指：最强特种作战能力"
  },
  { 
    id: "romance", 
    label: "言情甜宠", 
    icon: "💕",
    description: "甜宠日常、豪门联姻、总裁文青、校园恋爱",
    core: "先婚后爱/青梅竹马→霸总/校草独宠→双向奔赴→撒糖不断→圆满结局",
    tags: "甜宠,总裁,豪门,校园",
    example: "刚毕业的大学生苏晚晴阴差阳错嫁给了顾氏集团总裁顾北辰。本以为是契约婚姻，却发现老公对她早已蓄谋已久。\n\n核心冲突：\n1. 豪门规矩多\n2. 绿茶婊的陷害\n3. 隐藏身份的真相\n\n金手指：全能甜妻+读心术"
  },
  { 
    id: "infinite", 
    label: "无限流副本", 
    icon: "🔄",
    description: "副本迭代、规则杀、记忆重置、主线解谜",
    core: "被拉入无限世界→每个副本有生存规则→通关获奖励→解锁世界真相",
    tags: "无限流,恐怖,生存,烧脑",
    example: "萧夜被拉入一个神秘的无限世界，每个副本都是一场死亡游戏。只有完成任务才能活着离开，同时逐渐揭开这个世界的真相。\n\n核心冲突：\n1. 副本的死亡规则\n2. 其他玩家的竞争与合作\n3. 背后主谋的身份\n\n金手指：超强学习能力"
  },
  { 
    id: "loot", 
    label: "捡属性流", 
    icon: "✨",
    description: "击杀捡属性、捡功法、捡天赋、越阶杀敌",
    core: "主角能捡取他人/怪物属性→越打越强→越级反杀→快速登顶",
    tags: "玄幻,爽文,杀戮,异能",
    example: "林寒意外觉醒【万物可捡】系统，击杀敌人可以捡取他们的属性、技能、甚至寿命。从此走上最强捡漏王之路。\n\n核心冲突：\n1. 强大的敌人\n2. 系统的真正目的\n3. 各大势力的围剿\n\n金手指：万物可捡系统"
  },
  { 
    id: "soninlaw", 
    label: "赘婿战神", 
    icon: "🐉",
    description: "上门女婿、隐忍蛰伏、妻族羞辱、战神归来",
    core: "入赘受辱→暴露战神身份→打脸妻族→保护妻子→掌控全局",
    tags: "赘婿,战神,都市,复仇",
    example: "萧战是令地下世界闻风丧胆的【天狼】战神，却为了报恩入赘苏家。三年来受尽屈辱岳母嘲讽，直到某天妻子遇到危险，他终于不再隐藏身份...\n\n核心冲突：\n1. 丈母娘的刁难\n2. 家族势力的打压\n3. 隐藏身份的真相\n\n金手指：战神身份+超强实力"
  },
  { 
    id: "rules", 
    label: "规则怪谈", 
    icon: "📜",
    description: "诡异规则、生存挑战、逻辑悖论、破除诅咒",
    core: "进入规则怪谈世界→遵守/破解规则→找出规则漏洞→消灭源头",
    tags: "灵异,无限,恐怖,烧脑",
    example: "林夜被传送到一个被规则统治的诡异世界。这里的一切都受规则约束，只有找到规则的漏洞才能活下去。\n\n核心冲突：\n1. 诡异的规则\n2. 隐藏的真相\n3. 世界的本源\n\n金手指：逻辑推理大师"
  },
  { 
    id: "multiverse", 
    label: "诸天穿越", 
    icon: "🌌",
    description: "穿越诸天、掠夺世界、扮演角色、变强之路",
    core: "穿梭不同小说/影视世界→完成扮演任务→掠夺世界本源→成为诸天霸主",
    tags: "诸天,快穿,无限,穿越",
    example: "萧云获得【诸天穿越系统】，可以穿越到各种小说、影视、游戏世界。每个世界完成扮演任务都能获得世界本源之力。\n\n核心冲突：\n1. 各世界的土著强者\n2. 其他穿越者的竞争\n3. 系统的真正来源\n\n金手指：诸天穿越系统"
  },
  { 
    id: "tycoon", 
    label: "神豪系统", 
    icon: "💰",
    description: "无限金钱、消费返利、神级投资、挥霍变强",
    core: "获得无限金钱系统→花钱就能变强→投资垄断→享受顶级人生",
    tags: "都市,神豪,爽文,拜金",
    example: "穷小子林宇绑定【神豪消费系统】，消费金额就能获得返利，返利比例随消费额增加。从一笔小钱开始，他成为世界首富。\n\n核心冲突：\n1. 竞争对手的打压\n2. 财富带来的麻烦\n3. 隐藏身份的危机\n\n金手指：消费返利系统"
  },
  { 
    id: "politics", 
    label: "古风权谋", 
    icon: "🏯",
    description: "夺嫡之争、朝堂博弈、江湖恩怨、家国天下",
    core: "皇子/谋士→布局朝堂→拉拢势力→揭露阴谋→登基/匡扶社稷",
    tags: "古言,权谋,宫斗,历史",
    example: "庶出皇子萧衍，在母族被灭门后隐忍多年，暗中培植势力。他运筹帷幄，在夺嫡之争中一步步走向权力的巅峰。\n\n核心冲突：\n1. 兄弟间的皇位之争\n2. 朝堂上的党派林立\n3. 江湖势力的介入\n\n金手指：过目不忘+帝王心术"
  },
  { 
    id: "lovecraft", 
    label: "克苏鲁灵异", 
    icon: "🦑",
    description: "不可名状、san值狂掉、旧日支配者、调查员",
    core: "成为调查员→接触诡异事件→san值波动→对抗旧日支配者→守护人类",
    tags: "克苏鲁,灵异,暗黑,悬疑",
    example: "SCP基金会调查员林夜，在处理一起灵异事件时意外觉醒了【深潜者】血脉，从此看到了世界的另一面——那些不可名状的恐怖存在。\n\n核心冲突：\n1. 旧日支配者的苏醒\n2. 疯狂与理智的对抗\n3. 人类的存亡危机\n\n金手指：灵媒体质"
  },
  { 
    id: "cyberpunk", 
    label: "AI赛博朋克", 
    icon: "🤖",
    description: "脑机接口、数字生命、赛博改造、反抗资本",
    core: "未来都市→植入AI芯片→对抗科技寡头→寻找数字自我→觉醒意识",
    tags: "科幻,赛博,AI,反乌托邦",
    example: "2077年，边缘青年萧风为救治妹妹被迫植入非法AI芯片，却意外获得了超越人类的思维能力。他开始挑战资本巨头的统治。\n\n核心冲突：\n1. 科技公司的追捕\n2. AI意识的觉醒\n3. 人类的未来命运\n\n金手指：超级AI思维"
  },
  { 
    id: "heritage", 
    label: "非遗传承", 
    icon: "🏺",
    description: "传统手艺、文化守护、匠心坚守、国潮崛起",
    core: "非遗传承人→面临手艺失传→创新融合→让非遗走向世界",
    tags: "现实,文化,传承,治愈",
    example: "苏锦是苏绣传人，却在现代社会中面临手艺失传的危机。一次意外，她觉醒了【非遗系统】，开始让传统技艺焕发新生。\n\n核心冲突：\n1. 传统与现代的矛盾\n2. 商业化的诱惑\n3. 传承的责任\n\n金手指：非遗系统+设计灵感"
  },
];

// 模板示例数据（从 outlineTemplates 中提取）
const templateExamples: Record<string, { title: string; tags: string; description: string }> = {
  xianxia: { title: "仙途凡尘", tags: "仙侠,修炼,玄幻", description: "主角叶凡本是世俗少年，因缘际会之下觉醒了变异冰灵根，被带入青云宗外门。他身怀上古残缺功法，修炼速度远超同龄人，却被宗门天才视为眼中钉。一次秘境试炼中，他意外获得上古修士传承从此开启了逆天改命之路。\n\n核心冲突：\n1. 修炼资源匮乏，需要不断争夺\n2. 宗门内斗，被迫站队\n3. 上古势力苏醒，掀起修仙界动荡\n\n金手指：上古功法残篇，每次突破都能领悟神通" },
  urban: { title: "都市绝巅", tags: "都市,豪门,透视", description: "穷小子陈风意外获得家传玉佩传承，觉醒透视能力。赌石、鉴宝、医术、泡妞样样精通。从一个小小的古玩店老板，逐步建立起庞大的商业帝国。\n\n核心冲突：\n1. 豪门世家的打压与拉拢\n2. 地下势力的威胁\n3. 各路强者的挑战\n\n金手指：透视眼+家传功法" },
  system: { title: "最强系统", tags: "系统,都市,变强", description: "普通大学生林浩在失恋当天被宇宙最强系统选中，只要完成系统任务就能获得各种超能力。从最强武力到无上医术，从财富到寿命，全部都能兑换。\n\n核心冲突：\n1. 系统任务的难度与惩罚\n2. 其他宿主带来的威胁\n3. 逐渐揭开系统背后的真相\n\n金手指：最强超神系统" },
  reborn: { title: "重生2008", tags: "重生,回到过去,逆袭", description: "顶级富豪张铭重生回到2008年高考前夕。前世他白手起家创千亿帝国，却被最信任的人害死。这一世他要弥补所有遗憾，让那些背叛者付出代价。\n\n核心冲突：\n1. 阻止父母离婚，保住完整家庭\n2. 抢占前世商业先机\n3. 报复前世的仇人\n\n金手指：未来记忆" },
  game: { title: "降临游戏世界", tags: "游戏,异界,全息", description: "全球首款脑波接入游戏《神域》开服，玩家林羽进入游戏后发现自己变成了NPC。他拥有独立意识，能自主升级刷怪，成为游戏世界的一方霸主。\n\n核心冲突：\n1. 玩家与NPC的矛盾\n2. 游戏与现实的连接\n3. 背后开发公司的阴谋\n\n金手指：NPC觉醒+无限可能" },
  horror: { title: "死亡游戏", tags: "规则怪谈,无限流,恐怖", description: "陈默一觉醒来发现自己身处一栋诡秘的大楼中，唯一的出路是遵守规则并完成游戏。每层楼都有不同的死亡规则，只有找到规律才能活下去。\n\n核心冲突：\n1. 各种诡异的死亡规则\n2. 其他玩家的勾心斗角\n3. 隐藏在背后的组织\n\n金手指：过目不忘+冷静分析" },
  military: { title: "特战狂龙", tags: "特种兵,都市,兵王", description: "代号【青龙】的特种兵王萧龙完成任务后退役回归都市。然而平静的生活被打破，各方势力纷纷登场，他不得不重披战袍守护家人。\n\n核心冲突：\n1. 雇佣兵组织的报复\n2. 地下世界的挑战\n3. 隐藏的国籍危机\n\n金手指：最强特种作战能力" },
  romance: { title: "甜婚蜜爱", tags: "甜宠,总裁,豪门", description: "刚毕业的大学生苏晚晴阴差阳错嫁给了顾氏集团总裁顾北辰。本以为是契约婚姻，却发现老公对她早已蓄谋已久。\n\n核心冲突：\n1. 豪门规矩多\n2. 绿茶婊的陷害\n3. 隐藏身份的真相\n\n金手指：全能甜妻+读心术" },
  loot: { title: "万古捡漏王", tags: "玄幻,爽文,系统", description: "林寒意外觉醒【万物可捡】系统，击杀敌人可以捡取他们的属性、技能、甚至寿命。从此走上最强捡漏王之路。\n\n核心冲突：\n1. 强大的敌人\n2. 系统的真正目的\n3. 各大势力的围剿\n\n金手指：万物可捡系统" },
  infinite: { title: "无限轮回", tags: "无限流,恐怖,生存", description: "萧夜被拉入一个神秘的无限世界，每个副本都是一场死亡游戏。只有完成任务才能活着离开，同时逐渐揭开这个世界的真相。\n\n核心冲突：\n1. 副本的死亡规则\n2. 其他玩家的竞争与合作\n3. 背后主谋的身份\n\n金手指：超强学习能力" },
  soninlaw: { title: "隐龙战神", tags: "赘婿,战神,都市", description: "萧战是令地下世界闻风丧胆的【天狼】战神，却为了报恩入赘苏家。三年来受尽屈辱岳母嘲讽，直到某天妻子遇到危险，他终于不再隐藏身份...\n\n核心冲突：\n1. 丈母娘的刁难\n2. 家族势力的打压\n3. 隐藏身份的真相\n\n金手指：战神身份+超强实力" },
  rules: { title: "规则悖论", tags: "灵异,无限,恐怖", description: "林夜被传送到一个被规则统治的诡异世界。这里的一切都受规则约束，只有找到规则的漏洞才能活下去。\n\n核心冲突：\n1. 诡异的规则\n2. 隐藏的真相\n3. 世界的本源\n\n金手指：逻辑推理大师" },
  multiverse: { title: "诸天霸业", tags: "诸天,快穿,无限", description: "萧云获得【诸天穿越系统】，可以穿越到各种小说、影视、游戏世界。每个世界完成扮演任务都能获得世界本源之力。\n\n核心冲突：\n1. 各世界的土著强者\n2. 其他穿越者的竞争\n3. 系统的真正来源\n\n金手指：诸天穿越系统" },
  tycoon: { title: "全球首富", tags: "都市,神豪,爽文", description: "穷小子林宇绑定【神豪消费系统】，消费金额就能获得返利，返利比例随消费额增加。从一笔小钱开始，他成为世界首富。\n\n核心冲突：\n1. 竞争对手的打压\n2. 财富带来的麻烦\n3. 隐藏身份的危机\n\n金手指：消费返利系统" },
  politics: { title: "摄政天下", tags: "古言,权谋,宫斗", description: "庶出皇子萧衍，在母族被灭门后隐忍多年，暗中培植势力。他运筹帷幄，在夺嫡之争中一步步走向权力的巅峰。\n\n核心冲突：\n1. 兄弟间的皇位之争\n2. 朝堂上的党派林立\n3. 江湖势力的介入\n\n金手指：过目不忘+帝王心术" },
  lovecraft: { title: "深渊凝视", tags: "克苏鲁,灵异,暗黑", description: "SCP基金会调查员林夜，在处理一起灵异事件时意外觉醒了【深潜者】血脉，从此看到了世界的另一面——那些不可名状的恐怖存在。\n\n核心冲突：\n1. 旧日支配者的苏醒\n2. 疯狂与理智的对抗\n3. 人类的存亡危机\n\n金手指：灵媒体质" },
  cyberpunk: { title: "机械觉醒", tags: "科幻,赛博,AI", description: "2077年，边缘青年萧风为救治妹妹被迫植入非法AI芯片，却意外获得了超越人类的思维能力。他开始挑战资本巨头的统治。\n\n核心冲突：\n1. 科技公司的追捕\n2. AI意识的觉醒\n3. 人类的未来命运\n\n金手指：超级AI思维" },
  heritage: { title: "锦绣非遗", tags: "现实,文化,传承", description: "苏锦是苏绣传人，却在现代社会中面临手艺失传的危机。一次意外，她觉醒了【非遗系统】，开始让传统技艺焕发新生。\n\n核心冲突：\n1. 传统与现代的矛盾\n2. 商业化的诱惑\n3. 传承的责任\n\n金手指：非遗系统+设计灵感" },
};

const writingStyles = [
  { value: "standard", label: "标准网文", desc: "节奏明快、爽点密集、伏笔回收，适合都市/玄幻/赘婿" },
  { value: "literary", label: "文青风格", desc: "意象营造、心理刻画、留白叙事，适合古言/情感/悬疑" },
  { value: "fast", label: "快节奏爽文", desc: "开篇暴击、金手指秒用、循环打脸，适合系统/捡属性/无限流" },
  { value: "humor", label: "轻松幽默", desc: "玩梗、毒舌、沙雕队友、反差萌，适合搞笑/无限流" },
  { value: "serious", label: "严肃向", desc: "世界观严谨、人物弧光、权谋博弈，适合科幻/权谋/暗黑" },
  { value: "ruthless", label: "杀伐果断", desc: "斩草除根、利益至上、有仇必报，适合杀戮/末世/暗黑" },
  { value: "atmospheric", label: "氛围感拉满", desc: "光影描写、感官细节、情绪留白，适合灵异/克苏鲁/虐恋" },
  { value: "dialogue", label: "对话流爽文", desc: "短句对白、针锋相对、装逼打脸，适合职场/神豪/赘婿" },
  { value: "realistic", label: "细节流写实", desc: "生活细节、职业科普、社会观察，适合现实/职场/非遗" },
  { value: "brainhole", label: "脑洞解构风", desc: "反套路、吐槽套路、逻辑鬼才，适合无限流/系统/搞笑" },
  { value: "dark", label: "暗黑压抑风", desc: "绝望氛围、道德困境、悲剧美学，适合克苏鲁/末世/暗黑修仙" },
  { value: "sweet", label: "甜宠治愈风", desc: "双向奔赴、细节宠、情绪治愈，适合甜宠/校园/古风" },
  { value: "tech", label: "硬核科技风", desc: "硬核设定、技术细节、未来畅想，适合赛博/AI/科幻" },
  { value: "martial", label: "江湖烟火气", desc: "市井百态、江湖恩怨、侠骨柔情，适合武侠/古风/江湖" },
  { value: "live", label: "直播互动风", desc: "弹幕吐槽、实时反馈、观众视角，适合直播/怪谈/整活" },
];

export default function NovelOutlinePage() {
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState<Step>(1);
  
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [volumeCount, setVolumeCount] = useState(3);
  const [chaptersPerVolume, setChaptersPerVolume] = useState(10);
  const [narrativeStructure, setNarrativeStructure] = useState("standard");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [writingStyle, setWritingStyle] = useState("standard");

  const [globalPlan, setGlobalPlan] = useState<GlobalPlan | null>(null);
  const [editedGlobalPlan, setEditedGlobalPlan] = useState<GlobalPlan | null>(null);
  const [outline, setOutline] = useState<GeneratedVolume[] | null>(null);
  const [editedOutline, setEditedOutline] = useState<GeneratedVolume[] | null>(null);
  
  const [expandedChapter, setExpandedChapter] = useState<{vIdx: number; cIdx: number} | null>(null);
  const [editingChapter, setEditingChapter] = useState<{vIdx: number; cIdx: number} | null>(null);

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
      isOpen: boolean;
      title: string;
      message: string;
      onConfirm: () => void;
  }>({ isOpen: false, title: "", message: "", onConfirm: () => {} });

  const handleSelectTemplate = (templateId: string) => {
    const template = templateExamples[templateId];
    if (template) {
      setTitle(template.title);
      setTags(template.tags);
      setDescription(template.description);
      setSelectedTemplate(templateId);
      toast.success(`已应用「${outlineTemplates.find(t => t.id === templateId)?.label}」模板`);
    }
  };

  const clearTemplate = () => {
    setSelectedTemplate(null);
  };

  useEffect(() => {
      const searchParams = new URLSearchParams(window.location.search);
      const paramTitle = searchParams.get('title');
      const paramDesc = searchParams.get('description');
      const paramTags = searchParams.get('tags');

      if (paramTitle && paramDesc) {
          setTitle(paramTitle);
          setDescription(paramDesc);
          if (paramTags) setTags(paramTags);
          setLoadingProject(false);
          return;
      }

      getActiveNovelProject().then(p => {
          if (p) {
              setProject(p);
              setTitle(p.title);
              setDescription(p.description || "");
              setTags(p.tags.join(", "));
              
              if (p.outline && p.outline.length > 0) {
                  setOutline(p.outline.map(v => ({
                      title: v.title,
                      chapters: v.chapters.map(c => ({
                          title: c.title,
                          summary: c.summary,
                          content: c.content,
                          detail: c.detail
                      }))
                  })));
                  setVolumeCount(p.outline.length);
                  const totalCh = p.outline.reduce((acc, v) => acc + v.chapters.length, 0);
                  const avgCh = Math.ceil(totalCh / p.outline.length) || 10;
                  setChaptersPerVolume(avgCh);
                  setCurrentStep(3);
              }
          }
          setLoadingProject(false);
      });
  }, []);

  const showError = (message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  const handleStep1Submit = async () => {
    if (!title || !description) {
      showError("请填写小说标题和故事梗概");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/novel/outline/step1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tags,
          description,
          volumeCount,
          chaptersPerVolume,
          narrativeStructure,
          writingStyle
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "验证失败");
      }

      const data = await res.json();
      if (data.success) {
        setCurrentStep(2);
      }
    } catch (e: any) {
      showError(e.message || "验证失败");
    } finally {
      setGenerating(false);
    }
  };

  const handleStep2Generate = async () => {
    if (!title || !description) return;

    setGenerating(true);
    setGlobalPlan(null);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/novel/outline/step2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tags,
          description,
          volumeCount,
          chaptersPerVolume,
          narrativeStructure,
          writingStyle
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "生成失败");
      }

      const data = await res.json();
      if (data.success && data.data) {
        setGlobalPlan(data.data);
        setEditedGlobalPlan(data.data);
      } else {
        throw new Error("生成失败，请重试");
      }
    } catch (e: any) {
      showError(`生成核心设定出错: ${e.message || "未知错误"}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleStep3Generate = async () => {
    if (!title || !description) return;

    setGenerating(true);
    setOutline(null);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/novel/outline/step3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tags,
          description,
          volumeCount,
          chaptersPerVolume,
          narrativeStructure,
          writingStyle,
          globalPlan
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "生成失败");
      }

      const data = await res.json();
      if (data.success && data.data && data.data.outline) {
        setOutline(data.data.outline);
        setEditedOutline(data.data.outline);
      } else {
        throw new Error("AI 生成的大纲内容为空");
      }
    } catch (e: any) {
      showError(`生成详细大纲出错: ${e.message || "未知错误"}`);
    } finally {
      setGenerating(false);
    }
  };

  const updateOutline = (newOutline: GeneratedVolume[]) => {
    setOutline(newOutline);
    setEditedOutline(newOutline);
  };

  const handleAddVolume = () => {
    const currentOutline = editedOutline || outline;
    if (!currentOutline) return;
    const newVol: GeneratedVolume = {
        title: `第${currentOutline.length + 1}卷：新卷`,
        chapters: []
    };
    updateOutline([...currentOutline, newVol]);
  };

  const handleDeleteVolume = (vIdx: number) => {
    const currentOutline = editedOutline || outline;
    if (!currentOutline) return;
    setConfirmModal({
        isOpen: true,
        title: "删除确认",
        message: `确定要删除【${currentOutline[vIdx].title}】吗？\n该卷包含 ${currentOutline[vIdx].chapters.length} 个章节，删除后无法恢复。`,
        onConfirm: () => {
            const newOutline = currentOutline.filter((_, idx) => idx !== vIdx);
            updateOutline(newOutline);
            toast.success("已删除该卷");
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
    });
  };

  const handleAddChapter = (vIdx: number) => {
    const currentOutline = editedOutline || outline;
    if (!currentOutline) return;
    const newOutline = [...currentOutline];
    newOutline[vIdx].chapters.push({
        title: `第${newOutline[vIdx].chapters.length + 1}章 新章节`,
        summary: "请填写本章剧情摘要..."
    });
    updateOutline(newOutline);
  };

  const handleDeleteChapter = (vIdx: number, cIdx: number) => {
    const currentOutline = editedOutline || outline;
    if (!currentOutline) return;
    const chapterTitle = currentOutline[vIdx].chapters[cIdx].title;
    setConfirmModal({
        isOpen: true,
        title: "删除确认",
        message: `确定要删除章节【${chapterTitle}】吗？`,
        onConfirm: () => {
            const newOutline = currentOutline.map((vol, idx) => {
                if (idx !== vIdx) return vol;
                return {
                    ...vol,
                    chapters: vol.chapters.filter((_, cIdx2) => cIdx2 !== cIdx)
                };
            });
            updateOutline(newOutline);
            toast.success("已删除该章节");
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
    });
  };

  const handleUpdateChapter = (vIdx: number, cIdx: number, field: 'title' | 'summary', value: string) => {
    const currentOutline = editedOutline || outline;
    if (!currentOutline) return;
    const newOutline = currentOutline.map((vol, idx) => {
        if (idx !== vIdx) return vol;
        return {
            ...vol,
            chapters: vol.chapters.map((ch, cIdx2) => {
                if (cIdx2 !== cIdx) return ch;
                return { ...ch, [field]: value };
            })
        };
    });
    updateOutline(newOutline);
  };

  const handleUpdateVolumeTitle = (vIdx: number, value: string) => {
    const currentOutline = editedOutline || outline;
    if (!currentOutline) return;
    const newOutline = currentOutline.map((vol, idx) => {
        if (idx !== vIdx) return vol;
        return { ...vol, title: value };
    });
    updateOutline(newOutline);
  };

  const toggleChapterExpand = (vIdx: number, cIdx: number) => {
    if (expandedChapter?.vIdx === vIdx && expandedChapter?.cIdx === cIdx) {
      setExpandedChapter(null);
    } else {
      setExpandedChapter({ vIdx, cIdx });
    }
  };

  const startEditChapter = (vIdx: number, cIdx: number) => {
    setEditingChapter({ vIdx, cIdx });
  };

  const saveEditChapter = () => {
    setEditingChapter(null);
    toast.success("已保存");
  };

  const handleStep2Next = () => {
    const planToUse = editedGlobalPlan || globalPlan;
    if (!planToUse) {
      showError("请先生成核心设定");
      return;
    }
    setCurrentStep(3);
  };

  const updateGlobalPlanField = (field: keyof GlobalPlan, value: any) => {
    if (!editedGlobalPlan) return;
    setEditedGlobalPlan({
      ...editedGlobalPlan,
      [field]: value
    });
  };

  const handleUpdateCharacter = (idx: number, field: string, value: string) => {
    if (!editedGlobalPlan || !editedGlobalPlan.characterSettings) return;
    const newChars = editedGlobalPlan.characterSettings.map((char, i) => {
      if (i !== idx) return char;
      return { ...char, [field]: value };
    });
    setEditedGlobalPlan({
      ...editedGlobalPlan,
      characterSettings: newChars
    });
  };

  const handleUpdateArc = (idx: number, field: string, value: string) => {
    if (!editedGlobalPlan || !editedGlobalPlan.majorArcs) return;
    const newArcs = editedGlobalPlan.majorArcs.map((arc, i) => {
      if (i !== idx) return arc;
      return { ...arc, [field]: value };
    });
    setEditedGlobalPlan({
      ...editedGlobalPlan,
      majorArcs: newArcs
    });
  };

  const handleSave = async () => {
    const outlineToSave = editedOutline || outline;
    if (!outlineToSave) return;
    setSaving(true);

    try {
        const volumeOutlines: VolumeOutline[] = outlineToSave.map((vol) => ({
            title: vol.title,
            chapters: vol.chapters.map((ch) => ({
                title: ch.title,
                summary: ch.summary,
                content: ch.content,
                detail: (ch as any).detail
            }))
        }));

        const tagList = tags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
        let projectId = project?.id;

        if (project) {
            await updateNovelProject(project.id, {
                title,
                description,
                tags: tagList,
                outline: volumeOutlines
            });
        } else {
            projectId = (await createNovelProject(title, description, tagList, volumeOutlines)).id;
        }
        
        toast.success("大纲保存成功！即将跳转...");
        setTimeout(() => {
             if (projectId) {
                 router.push(`/novel/chapter?id=${projectId}`);
             } else {
                 router.push("/novel/chapter");
             }
        }, 500);
    } catch (e) {
        console.error(e);
        toast.error("保存失败，请重试");
    } finally {
        setSaving(false);
    }
  };

  const handleBackToStep1 = () => {
    setCurrentStep(1);
  };

  const handleBackToStep2 = () => {
    setCurrentStep(2);
  };

  const handleRestart = () => {
    setConfirmModal({
      isOpen: true,
      title: "重新开始",
      message: "确定要删除当前所有进度，重新开始吗？\n此操作将清空已生成的大纲和核心设定。",
      onConfirm: () => {
        setTitle("");
        setTags("");
        setDescription("");
        setVolumeCount(3);
        setChaptersPerVolume(10);
        setNarrativeStructure("standard");
        setGlobalPlan(null);
        setOutline(null);
        setCurrentStep(1);
        setProject(null);
        toast.success("已重新开始");
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0a] text-[#ededed]">
      <GeneratingOverlay
        open={generating}
        title={currentStep === 1 ? "验证信息..." : currentStep === 2 ? "正在生成核心设定" : "正在生成详细大纲"}
        detail={currentStep === 1 ? "请稍候" : currentStep === 2 ? "AI 正在构思世界观、角色与故事阶段..." : "请稍候，AI 正在设计分卷与章节结构"}
      />
      <Toaster position="top-center" theme="dark" />

      {errorMessage && (
        <div className="fixed top-8 left-1/2 transform -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-5 pointer-events-none">
          <div className="bg-[#1a1a1a] border border-red-500/50 text-red-200 px-6 py-4 rounded-lg shadow-2xl flex items-center gap-4 max-w-[600px] pointer-events-auto">
            <div className="bg-red-500/10 p-2 rounded-full shrink-0">
              <X size={20} className="text-red-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-[14px] text-red-400 mb-1">操作失败</h3>
              <p className="text-[12px] leading-relaxed opacity-90 whitespace-pre-wrap">{errorMessage}</p>
            </div>
            <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-white/10 rounded transition">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {confirmModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="w-[400px] bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
                  <div className="p-5 border-b border-[#333] flex items-center justify-between">
                      <h3 className="text-[16px] font-bold text-[#ededed]">{confirmModal.title}</h3>
                      <button onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} className="text-[#666] hover:text-[#ededed]">
                          <X size={18} />
                      </button>
                  </div>
                  <div className="p-6">
                      <p className="text-[14px] text-[#999] whitespace-pre-wrap leading-relaxed">{confirmModal.message}</p>
                  </div>
                  <div className="p-5 border-t border-[#333] flex items-center justify-end gap-3 bg-[#141414] rounded-b-lg">
                      <button onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} className="px-4 py-2 text-[13px] text-[#666] hover:text-[#ededed] transition">取消</button>
                      <button onClick={confirmModal.onConfirm} className="px-6 py-2 bg-[#e8c060] text-[#000] text-[13px] font-bold rounded hover:brightness-110 transition">确认</button>
                  </div>
              </div>
          </div>
      )}

      <div className="px-8 py-6 border-b border-[#1f1f1f] bg-[#0a0a0a] shrink-0 flex items-center justify-between">
          <div className="flex flex-col gap-1">
              <h1 className="text-[32px] font-serif font-bold text-[#ededed] flex items-center gap-2 tracking-wide">
                  AI 大纲生成
              </h1>
          </div>
          <div className="flex items-center gap-3">
              <button 
                  onClick={handleRestart}
                  className="flex items-center gap-2 px-4 py-2 border border-[#333] text-[#666] text-[13px] rounded hover:text-[#ededed] hover:border-[#666] transition"
              >
                  <RotateCcw size={14} />
                  重新开始
              </button>
              {(editedOutline || outline) && currentStep === 3 && (
                  <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-[#e8c060] text-[#000] text-[13px] font-bold rounded hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#e8c060]/10">
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      保存大纲
                  </button>
              )}
          </div>
      </div>

      <div className="px-8 py-4 border-b border-[#1f1f1f] bg-[#0d0d0d] shrink-0">
        <div className="flex items-center justify-center gap-4">
          <StepIndicator step={1} currentStep={currentStep} icon={FileText} label="基础信息" />
          <div className={`h-px w-16 ${currentStep >= 2 ? 'bg-[#e8c060]' : 'bg-[#333]'}`} />
          <StepIndicator step={2} currentStep={currentStep} icon={Settings2} label="核心设定" />
          <div className={`h-px w-16 ${currentStep >= 3 ? 'bg-[#e8c060]' : 'bg-[#333]'}`} />
          <StepIndicator step={3} currentStep={currentStep} icon={Layers} label="详细大纲" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-[1000px] mx-auto p-8">
              
              {currentStep === 1 && (
                <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-right-8 duration-500">
                    <div className="text-center mb-8">
                        <h2 className="text-[24px] font-bold text-[#ededed] mb-2">填写小说基础信息</h2>
                        <p className="text-[14px] text-[#666]">输入你的创意想法，AI 将以此为基础逐步生成完整大纲</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#0d0d0d] p-8 rounded-xl border border-[#1f1f1f]">
                        <div className="flex flex-col gap-2">
                            <label className="text-[12px] text-[#666]">小说名称 <span className="text-red-500">*</span></label>
                            <input 
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="例如：都市之巅峰强者"
                                className="px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[12px] text-[#666]">题材类型</label>
                            <input 
                                value={tags}
                                onChange={(e) => setTags(e.target.value)}
                                placeholder="例如：都市、玄幻、系統、重生..."
                                className="px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition"
                            />
                        </div>
                        <div className="md:col-span-2 flex flex-col gap-2">
                            <label className="text-[12px] text-[#666]">故事梗概 <span className="text-red-500">*</span></label>
                            <textarea 
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="请输入故事核心冲突、主角设定、金手指、大致剧情走向...（建议 100-500 字）"
                                className="px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition min-h-[140px] resize-none"
                            />
                        </div>
                        <div className="md:col-span-2 flex items-center gap-8 p-4 bg-[#141414] rounded-lg border border-[#1f1f1f]">
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[12px] text-[#666]">分卷数</label>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => setVolumeCount(Math.max(1, volumeCount - 1))}
                                            className="w-8 h-8 flex items-center justify-center bg-[#1a1a1a] border border-[#333] rounded hover:border-[#e8c060]/50 transition"
                                        >-</button>
                                        <input 
                                            type="number"
                                            value={volumeCount}
                                            onChange={(e) => setVolumeCount(Math.max(1, Math.min(20, Number(e.target.value))))}
                                            className="w-[60px] text-center px-2 py-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50"
                                        />
                                        <button 
                                            onClick={() => setVolumeCount(Math.min(20, volumeCount + 1))}
                                            className="w-8 h-8 flex items-center justify-center bg-[#1a1a1a] border border-[#333] rounded hover:border-[#e8c060]/50 transition"
                                        >+</button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[12px] text-[#666]">每卷章节数</label>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => setChaptersPerVolume(Math.max(1, chaptersPerVolume - 1))}
                                            className="w-8 h-8 flex items-center justify-center bg-[#1a1a1a] border border-[#333] rounded hover:border-[#e8c060]/50 transition"
                                        >-</button>
                                        <input 
                                            type="number"
                                            value={chaptersPerVolume}
                                            onChange={(e) => setChaptersPerVolume(Math.max(1, Math.min(100, Number(e.target.value))))}
                                            className="w-[60px] text-center px-2 py-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50"
                                        />
                                        <button 
                                            onClick={() => setChaptersPerVolume(Math.min(100, chaptersPerVolume + 1))}
                                            className="w-8 h-8 flex items-center justify-center bg-[#1a1a1a] border border-[#333] rounded hover:border-[#e8c060]/50 transition"
                                        >+</button>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col items-end gap-1">
                                <span className="text-[12px] text-[#666]">预计总章节</span>
                                <span className="text-[24px] font-bold text-[#e8c060]">{volumeCount * chaptersPerVolume}</span>
                            </div>
                        </div>
                        <div className="md:col-span-2 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[12px] text-[#666]">叙事结构</label>
                                {selectedTemplate && (
                                    <button onClick={clearTemplate} className="text-[10px] text-[#e8c060] hover:underline">
                                        清除模板
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                {narrativeStructures.map((struct) => (
                                    <button
                                        key={struct.value}
                                        onClick={() => setNarrativeStructure(struct.value)}
                                        className={`p-3 rounded-lg border text-left transition ${
                                            narrativeStructure === struct.value 
                                                ? 'bg-[#e8c060]/10 border-[#e8c060] text-[#e8c060]' 
                                                : 'bg-[#141414] border-[#1f1f1f] text-[#666] hover:border-[#444]'
                                        }`}
                                    >
                                        <div className="text-[13px] font-bold mb-1">{struct.label}</div>
                                        <div className="text-[10px] opacity-70">{struct.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="md:col-span-2 flex flex-col gap-3">
                            <label className="text-[12px] text-[#666]">
                                大纲模板 
                                <span className="text-[10px] text-[#666] ml-2">（选择一个模板自动填充标题/标签/剧情）</span>
                            </label>
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                                {outlineTemplates.map((template) => (
                                    <button
                                        key={template.id}
                                        onClick={() => handleSelectTemplate(template.id)}
                                        className={`p-2.5 rounded-lg border text-left transition-all duration-200 group ${
                                            selectedTemplate === template.id
                                                ? 'bg-[#e8c060]/10 border-[#e8c060] shadow-lg shadow-[#e8c060]/5'
                                                : 'bg-[#141414] border-[#1f1f1f] hover:border-[#e8c060]/30 hover:bg-[#1a1a1a]'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <span className="text-[14px]">{template.icon}</span>
                                            <span className={`text-[12px] font-bold truncate ${
                                                selectedTemplate === template.id ? 'text-[#e8c060]' : 'text-[#ededed]'
                                            }`}>{template.label}</span>
                                        </div>
                                        <div className="text-[9px] text-[#555] leading-tight line-clamp-2 mb-1.5 opacity-80 group-hover:opacity-100">
                                            {template.core}
                                        </div>
                                        <div className="text-[8px] text-[#444] truncate">
                                            {template.tags}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="md:col-span-2 flex flex-col gap-3">
                            <label className="text-[12px] text-[#666]">写作风格</label>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                {writingStyles.map((style) => (
                                    <button
                                        key={style.value}
                                        onClick={() => setWritingStyle(style.value)}
                                        className={`p-3 rounded-lg border text-left transition ${
                                            writingStyle === style.value 
                                                ? 'bg-[#e8c060]/10 border-[#e8c060] text-[#e8c060]' 
                                                : 'bg-[#141414] border-[#1f1f1f] text-[#666] hover:border-[#444]'
                                        }`}
                                    >
                                        <div className="text-[13px] font-bold mb-1">{style.label}</div>
                                        <div className="text-[10px] opacity-70">{style.desc}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end pt-4">
                        <button 
                            onClick={handleStep1Submit}
                            disabled={generating || !title || !description}
                            className="flex items-center gap-2 px-8 py-3 bg-[#e8c060] text-[#000] text-[14px] font-bold rounded hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#e8c060]/10"
                        >
                            下一步：生成核心设定
                            <ArrowRight size={18} />
                        </button>
                    </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-right-8 duration-500">
                    <div className="text-center mb-8">
                        <h2 className="text-[24px] font-bold text-[#ededed] mb-2">核心设定</h2>
                        <p className="text-[14px] text-[#666]">AI 已根据你的基础信息生成核心设定，请确认后进入下一步</p>
                    </div>

                    {!editedGlobalPlan ? (
                        <div className="flex flex-col items-center justify-center py-16 bg-[#0d0d0d] rounded-xl border border-[#1f1f1f]">
                            <div className="text-center mb-6">
                                <Sparkles size={48} className="text-[#e8c060] mx-auto mb-4" />
                                <h3 className="text-[18px] font-bold text-[#ededed] mb-2">准备生成核心设定</h3>
                                <p className="text-[14px] text-[#666] max-w-md">AI 将生成：世界观设定、主角与配角设定、核心冲突、故事分期阶段</p>
                            </div>
                            <button 
                                onClick={handleStep2Generate}
                                disabled={generating}
                                className="flex items-center gap-2 px-8 py-3 bg-[#e8c060] text-[#000] text-[14px] font-bold rounded hover:brightness-110 transition disabled:opacity-50"
                            >
                                {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                                {generating ? "AI 正在构思..." : "开始生成"}
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            <div className="bg-[#0d0d0d] p-6 rounded-xl border border-[#1f1f1f]">
                                <h3 className="text-[14px] font-bold text-[#e8c060] mb-4 flex items-center gap-2">
                                    <Map size={16} /> 世界观设定
                                </h3>
                                <textarea 
                                    value={editedGlobalPlan.worldSettings || ""}
                                    onChange={(e) => updateGlobalPlanField("worldSettings", e.target.value)}
                                    className="w-full h-32 px-3 py-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#999] outline-none focus:border-[#e8c060]/50 resize-none"
                                    placeholder="请输入世界观设定..."
                                />
                            </div>

                            <div className="bg-[#0d0d0d] p-6 rounded-xl border border-[#1f1f1f]">
                                <h3 className="text-[14px] font-bold text-[#e8c060] mb-4 flex items-center gap-2">
                                    <BookOpen size={16} /> 核心剧情走向
                                </h3>
                                <textarea 
                                    value={editedGlobalPlan.corePlot || ""}
                                    onChange={(e) => updateGlobalPlanField("corePlot", e.target.value)}
                                    className="w-full h-32 px-3 py-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[14px] text-[#999] outline-none focus:border-[#e8c060]/50 resize-none"
                                    placeholder="请输入核心剧情走向..."
                                />
                            </div>

                            <div className="bg-[#0d0d0d] p-6 rounded-xl border border-[#1f1f1f]">
                                <h3 className="text-[14px] font-bold text-[#e8c060] mb-4 flex items-center gap-2">
                                    <Users size={16} /> 主要角色
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {editedGlobalPlan.characterSettings?.map((char: any, idx: number) => (
                                        <div key={idx} className="p-4 bg-[#141414] rounded-lg border border-[#1f1f1f]">
                                            <input 
                                                value={char.name || ""}
                                                onChange={(e) => handleUpdateCharacter(idx, "name", e.target.value)}
                                                className="w-full font-bold text-[#ededed] mb-2 bg-transparent border-b border-[#333] pb-1 outline-none focus:border-[#e8c060]"
                                                placeholder="角色名称"
                                            />
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] text-[#888] w-10 shrink-0">性格：</span>
                                                    <input 
                                                        value={char.personality || ""}
                                                        onChange={(e) => handleUpdateCharacter(idx, "personality", e.target.value)}
                                                        className="flex-1 bg-transparent text-[12px] text-[#666] outline-none border-b border-[#333] focus:border-[#e8c060]"
                                                        placeholder="性格描述"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] text-[#888] w-10 shrink-0">动机：</span>
                                                    <input 
                                                        value={char.motivation || ""}
                                                        onChange={(e) => handleUpdateCharacter(idx, "motivation", e.target.value)}
                                                        className="flex-1 bg-transparent text-[12px] text-[#666] outline-none border-b border-[#333] focus:border-[#e8c060]"
                                                        placeholder="角色动机"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] text-[#888] w-10 shrink-0">结局：</span>
                                                    <input 
                                                        value={char.fate || ""}
                                                        onChange={(e) => handleUpdateCharacter(idx, "fate", e.target.value)}
                                                        className="flex-1 bg-transparent text-[12px] text-[#666] outline-none border-b border-[#333] focus:border-[#e8c060]"
                                                        placeholder="角色结局"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-[#0d0d0d] p-6 rounded-xl border border-[#1f1f1f]">
                                <h3 className="text-[14px] font-bold text-[#e8c060] mb-4 flex items-center gap-2">
                                    <Layers size={16} /> 故事阶段规划
                                </h3>
                                <div className="space-y-3">
                                    {editedGlobalPlan.majorArcs?.map((arc: any, idx: number) => (
                                        <div key={idx} className="flex gap-4 p-3 bg-[#141414] rounded-lg border border-[#1f1f1f]">
                                            <span className="text-[#e8c060] font-bold text-[14px] w-8 shrink-0">{idx + 1}</span>
                                            <div className="flex-1 space-y-2">
                                                <input 
                                                    value={arc.title || ""}
                                                    onChange={(e) => handleUpdateArc(idx, "title", e.target.value)}
                                                    className="w-full font-bold text-[#ededed] text-[14px] bg-transparent border-b border-[#333] pb-1 outline-none focus:border-[#e8c060]"
                                                    placeholder="阶段标题"
                                                />
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] text-[#888] w-10 shrink-0">目标：</span>
                                                    <input 
                                                        value={arc.goal || ""}
                                                        onChange={(e) => handleUpdateArc(idx, "goal", e.target.value)}
                                                        className="flex-1 bg-transparent text-[12px] text-[#666] outline-none border-b border-[#333] focus:border-[#e8c060]"
                                                        placeholder="阶段目标"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] text-[#888] w-10 shrink-0">高潮：</span>
                                                    <input 
                                                        value={arc.highPoint || ""}
                                                        onChange={(e) => handleUpdateArc(idx, "highPoint", e.target.value)}
                                                        className="flex-1 bg-transparent text-[12px] text-[#666] outline-none border-b border-[#333] focus:border-[#e8c060]"
                                                        placeholder="高潮事件"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex justify-between pt-6">
                                <button 
                                    onClick={handleBackToStep1}
                                    className="flex items-center gap-2 px-6 py-3 border border-[#333] text-[#666] text-[14px] rounded hover:text-[#ededed] hover:border-[#666] transition"
                                >
                                    <ArrowLeft size={18} />
                                    返回上一步
                                </button>
                                <div className="flex gap-3">
                                    <button 
                                        onClick={handleStep2Generate}
                                        disabled={generating}
                                        className="flex items-center gap-2 px-6 py-3 border border-[#e8c060]/30 text-[#e8c060] text-[14px] rounded hover:bg-[#e8c060]/10 transition disabled:opacity-50"
                                    >
                                        <RotateCcw size={16} />
                                        重新生成
                                    </button>
                                    <button 
                                        onClick={handleStep2Next}
                                        className="flex items-center gap-2 px-8 py-3 bg-[#e8c060] text-[#000] text-[14px] font-bold rounded hover:brightness-110 transition shadow-lg shadow-[#e8c060]/10"
                                    >
                                        下一步：生成详细大纲
                                        <ArrowRight size={18} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
              )}

              {currentStep === 3 && (
                <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-8 duration-500">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-[24px] font-bold text-[#ededed] mb-1">详细大纲</h2>
                            <p className="text-[14px] text-[#666]">基于核心设定生成完整的分卷与章节结构</p>
                        </div>
                        {!outline && (
                            <button 
                                onClick={handleStep3Generate}
                                disabled={generating}
                                className="flex items-center gap-2 px-8 py-3 bg-[#e8c060] text-[#000] text-[14px] font-bold rounded hover:brightness-110 transition disabled:opacity-50 shadow-lg shadow-[#e8c060]/10"
                            >
                                {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                                {generating ? "AI 正在构思..." : "生成详细大纲"}
                            </button>
                        )}
                    </div>

                    {!outline ? (
                        <div className="flex flex-col items-center justify-center py-20 bg-[#0d0d0d] rounded-xl border border-[#1f1f1f]">
                            <Layers size={64} className="text-[#333] mb-4" />
                            <p className="text-[14px] text-[#666]">点击上方按钮生成详细大纲</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between pb-4 border-b border-[#1f1f1f]">
                                <div className="flex items-center gap-4">
                                    <div className="flex bg-[#1a1a1a] rounded-lg p-1 border border-[#333]">
                                        <button onClick={() => setViewMode("list")} className={`p-1.5 rounded transition ${viewMode === "list" ? "bg-[#333] text-[#ededed]" : "text-[#666] hover:text-[#ededed]"}`}>
                                            <ListIcon size={14} />
                                        </button>
                                        <button onClick={() => setViewMode("board")} className={`p-1.5 rounded transition ${viewMode === "board" ? "bg-[#333] text-[#ededed]" : "text-[#666] hover:text-[#ededed]"}`}>
                                            <LayoutGrid size={14} />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={handleBackToStep2} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#333] text-[#666] text-[12px] rounded hover:text-[#ededed] hover:border-[#666] transition">
                                        <ArrowLeft size={12} />
                                        修改核心设定
                                    </button>
                                    <button onClick={() => setOutline(null)} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#333] text-[#666] text-[12px] rounded hover:text-[#ededed] hover:border-[#666] transition">
                                        <RotateCcw size={12} />
                                        重新生成
                                    </button>
                                    <button onClick={handleAddVolume} className="flex items-center gap-1.5 px-3 py-1.5 border border-[#333] text-[#666] text-[12px] rounded hover:text-[#ededed] hover:border-[#666] transition">
                                        <Plus size={12} />
                                        添加卷
                                    </button>
                                </div>
                            </div>

                            {viewMode === "list" ? (
                                <div className="flex flex-col gap-6 pb-20">
                                    {(editedOutline || outline).map((volume, vIdx) => (
                                        <div key={vIdx} className="flex flex-col gap-4">
                                            <div className="flex items-center gap-4">
                                                <BookOpen size={16} className="text-[#e8c060]" />
                                                <input 
                                                    value={volume.title}
                                                    onChange={(e) => handleUpdateVolumeTitle(vIdx, e.target.value)}
                                                    className="text-[16px] font-bold text-[#ededed] bg-transparent border-b border-transparent hover:border-[#333] focus:border-[#e8c060] outline-none"
                                                />
                                                <div className="h-[1px] flex-1 bg-[#1f1f1f]"></div>
                                                <span className="text-[12px] text-[#666]">{volume.chapters?.length || 0} 章</span>
                                                <button onClick={() => handleAddChapter(vIdx)} className="p-1 text-[#666] hover:text-[#ededed]" title="添加章节"><Plus size={16} /></button>
                                                <button onClick={() => handleDeleteVolume(vIdx)} className="p-1 text-[#666] hover:text-red-500" title="删除本卷"><Trash2 size={16} /></button>
                                            </div>
                                            <div className="pl-8 flex flex-col gap-3">
                                                {volume.chapters?.map((chapter, cIdx) => {
                                                    const isExpanded = expandedChapter?.vIdx === vIdx && expandedChapter?.cIdx === cIdx;
                                                    const isEditing = editingChapter?.vIdx === vIdx && editingChapter?.cIdx === cIdx;
                                                    return (
                                                        <div key={cIdx} className={`group bg-[#0d0d0d] border rounded-lg p-5 transition cursor-pointer flex flex-col gap-3 relative ${isExpanded ? 'border-[#e8c060] shadow-lg' : 'border-[#1f1f1f] hover:border-[#e8c060]/30'}`}>
                                                            <div className="flex items-center justify-between">
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-[13px] font-mono text-[#666]">{cIdx + 1}.</span>
                                                                    {isEditing ? (
                                                                        <input 
                                                                            value={chapter.title}
                                                                            onChange={(e) => handleUpdateChapter(vIdx, cIdx, 'title', e.target.value)}
                                                                            className="text-[15px] font-bold text-[#e8c060] bg-transparent border-b border-[#e8c060] outline-none"
                                                                        />
                                                                    ) : (
                                                                        <h4 
                                                                            onClick={() => toggleChapterExpand(vIdx, cIdx)}
                                                                            className="text-[15px] font-bold text-[#ededed]"
                                                                        >
                                                                            {chapter.title}
                                                                        </h4>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {isEditing ? (
                                                                        <button onClick={saveEditChapter} className="p-1.5 text-green-500 hover:text-green-400 rounded transition" title="保存">
                                                                            <Check size={14} />
                                                                        </button>
                                                                    ) : (
                                                                        <button onClick={() => startEditChapter(vIdx, cIdx)} className="p-1.5 text-[#666] hover:text-[#e8c060] rounded transition opacity-0 group-hover:opacity-100" title="编辑">
                                                                            <Edit size={14} />
                                                                        </button>
                                                                    )}
                                                                    <button onClick={() => toggleChapterExpand(vIdx, cIdx)} className={`p-1.5 rounded transition ${isExpanded ? 'text-[#e8c060]' : 'text-[#666] hover:text-[#ededed] opacity-0 group-hover:opacity-100'}`} title={isExpanded ? "收起" : "展开"}>
                                                                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                    </button>
                                                                    <button onClick={() => handleDeleteChapter(vIdx, cIdx)} className="p-1.5 text-[#666] hover:text-red-500 rounded transition opacity-0 group-hover:opacity-100" title="删除章节">
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            {isExpanded ? (
                                                                <div className="mt-2 pt-3 border-t border-[#333]">
                                                                    <textarea 
                                                                        value={chapter.summary}
                                                                        onChange={(e) => handleUpdateChapter(vIdx, cIdx, 'summary', e.target.value)}
                                                                        className="w-full h-40 px-3 py-2 bg-[#0a0a0a] border border-[#1f1f1f] rounded text-[13px] text-[#888] outline-none focus:border-[#e8c060]/50 resize-none"
                                                                        placeholder="请输入章节摘要..."
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <p className="text-[13px] text-[#888] leading-relaxed line-clamp-2">{chapter.summary}</p>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex gap-6 overflow-x-auto pb-6 h-full items-start">
                                    {(editedOutline || outline).map((volume, vIdx) => (
                                        <div key={vIdx} className="min-w-[320px] max-w-[320px] bg-[#1a1a1a] border border-[#333] rounded-xl flex flex-col max-h-[700px] shadow-xl">
                                            <div className="p-4 border-b border-[#333] flex items-center justify-between bg-[#222] rounded-t-xl sticky top-0 z-10">
                                                <div className="flex flex-col gap-1">
                                                    <input 
                                                        value={volume.title}
                                                        onChange={(e) => handleUpdateVolumeTitle(vIdx, e.target.value)}
                                                        className="text-[14px] font-bold text-[#ededed] bg-transparent border-b border-transparent hover:border-[#444] focus:border-[#e8c060] outline-none truncate w-[200px]"
                                                        title={volume.title}
                                                    />
                                                    <span className="text-[11px] text-[#666]">{volume.chapters?.length || 0} 个章节</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => handleAddChapter(vIdx)} className="p-1.5 text-[#888] hover:text-[#ededed] hover:bg-[#333] rounded transition" title="添加章节"><Plus size={14} /></button>
                                                    <button onClick={() => handleDeleteVolume(vIdx)} className="p-1.5 text-[#888] hover:text-red-400 hover:bg-[#333] rounded transition" title="删除本卷"><MoreHorizontal size={14} /></button>
                                                </div>
                                            </div>
                                            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 custom-scrollbar">
                                                {volume.chapters?.map((chapter, cIdx) => {
                                                    const isExpanded = expandedChapter?.vIdx === vIdx && expandedChapter?.cIdx === cIdx;
                                                    return (
                                                        <div key={cIdx} onClick={() => toggleChapterExpand(vIdx, cIdx)} className={`bg-[#2a2a2a] p-3 rounded-lg border transition group cursor-pointer flex flex-col gap-2 ${isExpanded ? 'border-[#e8c060] shadow-lg' : 'border-[#333] hover:border-[#e8c060]/50 hover:shadow-md'}`}>
                                                            {isExpanded ? (
                                                                <>
                                                                    <input 
                                                                        value={chapter.title}
                                                                        onChange={(e) => handleUpdateChapter(vIdx, cIdx, 'title', e.target.value)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="text-[13px] font-bold text-[#e8c060] bg-transparent border-b border-[#e8c060] outline-none"
                                                                    />
                                                                    <textarea 
                                                                        value={chapter.summary}
                                                                        onChange={(e) => handleUpdateChapter(vIdx, cIdx, 'summary', e.target.value)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="text-[11px] text-[#888] bg-[#1a1a1a] p-2 rounded outline-none focus:border-[#e8c060]/50 resize-none h-32"
                                                                        placeholder="请输入章节摘要..."
                                                                    />
                                                                    <div className="flex items-center justify-between mt-1 pt-2 border-t border-[#333]">
                                                                        <span className="text-[10px] font-mono text-[#555]">#{cIdx + 1}</span>
                                                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteChapter(vIdx, cIdx); }} className="text-[#666] hover:text-red-400 transition">
                                                                            <Trash2 size={12} />
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <h4 className="text-[13px] font-bold text-[#ededed] leading-tight">{chapter.title}</h4>
                                                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteChapter(vIdx, cIdx); }} className="opacity-0 group-hover:opacity-100 text-[#666] hover:text-red-400 transition">
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-[11px] text-[#888] line-clamp-3 leading-relaxed">{chapter.summary || "暂无简介"}</p>
                                                                    <div className="flex items-center justify-between mt-1 pt-2 border-t border-[#333]">
                                                                        <span className="text-[10px] font-mono text-[#555]">#{cIdx + 1}</span>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                <button onClick={() => handleAddChapter(vIdx)} className="w-full py-2 border border-dashed border-[#444] text-[#666] text-[12px] rounded hover:border-[#666] hover:text-[#888] transition flex items-center justify-center gap-2">
                                                    <Plus size={12} /> 添加章节
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    <button onClick={handleAddVolume} className="min-w-[50px] h-[300px] border-2 border-dashed border-[#222] rounded-xl flex items-center justify-center text-[#333] hover:text-[#666] hover:border-[#333] transition">
                                        <Plus size={24} />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
              )}
          </div>
      </div>
    </div>
  );
}

function StepIndicator({ step, currentStep, icon: Icon, label }: { step: number; currentStep: number; icon: any; label: string }) {
  const isActive = currentStep >= step;
  const isCurrent = currentStep === step;
  
  return (
    <div className={`flex items-center gap-2 ${isActive ? 'text-[#e8c060]' : 'text-[#444]'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition ${
        isCurrent 
          ? 'bg-[#e8c060] border-[#e8c060] text-[#000]' 
          : isActive 
            ? 'bg-[#1a1a1a] border-[#e8c060] text-[#e8c060]' 
            : 'bg-[#1a1a1a] border-[#333] text-[#444]'
      }`}>
        {isActive && currentStep > step ? <Check size={16} /> : <Icon size={16} />}
      </div>
      <span className={`text-[13px] font-medium ${isActive ? 'text-[#e8c060]' : 'text-[#444]'}`}>{label}</span>
    </div>
  );
}
