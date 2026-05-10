/*  cards.js  —  one embed = one (rarity+group) block  */
const Eris = require('eris');
const Card = require('../../models/card');
const Graphic = require('../../models/graphic');
const specialGroups = require('../../config/specialGroups');

/*  ----------  CONFIG  ----------  */
const RARITY_EMOJIS = {
  standard: '<:x_:1256609888302272542><:Rx:1256632501523316778><:Rx:1256632501523316778><:Rx:1256632501523316778>',
  unique: '<:xx:1256609884795965472><:xx:1256609884795965472><:Rxx:1256632495835709492><:Rxx:1256632495835709492>',
  glyph: '<:xxx:1256609893239095396><:xxx:1256609893239095396><:xxx:1256609893239095396><:Rxxx:1256632499073978398>',
  mythic: '<:xxxx:1256609881595838636><:xxxx:1256609881595838636><:xxxx:1256609881595838636><:xxxx:1256609881595838636>',
};
const RARITY_ORDER = { mythic: 4, glyph: 3, unique: 2, standard: 1 };
const COLLECTOR_TTL = 60_000;

/*  ----------  UTILS  ----------  */
const buildBlock = (cards, groupDisplayName) => {
  const first = cards[0];
  const emoji = RARITY_EMOJIS[first.rarity.toLowerCase()] ?? '';
  const displayGroup = groupDisplayName || first.group.toUpperCase();
  const header = `### ${emoji} ${displayGroup} — ${first.rarity.toUpperCase()} (${cards.length} card${cards.length>1?'s':''})`;
  
  const lines = cards
    .sort((a,b)=> {
      const numA = parseInt(String(a.cardId).replace(/\D/g, '')) || 0;
      const numB = parseInt(String(b.cardId).replace(/\D/g, '')) || 0;
      return numA - numB;
    })
    .map(c=>`• \`${c.cardId}\` [${c.name}](${c.imageURL})`)
    .join('\n');
  
  return `${header}\n${lines}`;
};

module.exports = {
  name: 'cards',
  description: 'View your cards',
  execute: async (msg, args, client) => {
    const userId = msg.author.id;
    const graphic = await Graphic.findOne({ userId });
    if (!graphic?.isRegistered)
      return client.createMessage(msg.channel.id, {
        embeds: [{
          title:'🚫 Uncharted Territory',
          description:'Use `?register` to begin your journey!',
          color:0xff6b6b
        }],
        messageReference:{messageID:msg.id}
      });

    if (!args.length) return msg.channel.createMessage({ content: 'Please provide a search term.', messageReference: { messageID: msg.id } });
    const searchTerms = args.flatMap(t => specialGroups.expandSearchTerm(t.toLowerCase()));

    const query = {
      $and: searchTerms.map(term=>({
        $or:[
          {name:{$regex:term,$options:'i'}},
          {group:{$regex:term,$options:'i'}},
          {rarity:{$regex:term,$options:'i'}}
        ]
      }))
    };
    const cards = await Card.find(query).lean();
    if (!cards.length) return msg.channel.createMessage({ content: 'No cards found matching the search terms.', messageReference: { messageID: msg.id } });

    /* 1. group by (rarity+group), but combine special groups */
    const buckets = {};
    for (const c of cards){
      const specialGroup = specialGroups.matchGroupName(c.group);
      let key;
      
      if (specialGroup && specialGroup.isCombined) {
        // Combine all cards from this special group under one key
        key = `${c.rarity.toLowerCase()}-special-${specialGroup.displayName.toLowerCase()}`;
      } else {
        // Regular grouping
        key = `${c.rarity.toLowerCase()}-${c.group.toLowerCase()}`;
      }
      
      if (!buckets[key]) {
        buckets[key] = {
          cards: [],
          displayName: specialGroup?.displayName || null
        };
      }
      buckets[key].cards.push(c);
    }

    /* 2. sort blocks: rarity first, then group alpha */
    const blocks = Object.entries(buckets).map(([key, data]) => ({
      key,
      cards: data.cards,
      displayName: data.displayName
    })).sort((A, B) => {
      const ra = RARITY_ORDER[A.cards[0].rarity.toLowerCase()];
      const rb = RARITY_ORDER[B.cards[0].rarity.toLowerCase()];
      if (ra !== rb) return rb - ra;
      
      const nameA = A.displayName || A.cards[0].group;
      const nameB = B.displayName || B.cards[0].group;
      return nameA.localeCompare(nameB);
    });

    /* 3. pagination vars */
    const totalPages = blocks.length;
    if (!totalPages) return msg.channel.createMessage({ content: 'No cards found.', messageReference: { messageID: msg.id } });
    let currentPage = 1;

    /* 4. embed generator */
    const buildEmbed = (page)=>{
      const block = blocks[page-1];
      const description = buildBlock(block.cards, block.displayName);
      
      // If still too long (>4096), truncate with warning
      const finalDesc = description.length > 4096 
        ? description.slice(0, 4090) + '\n...' 
        : description;
      
      return {
        author:{name:`${msg.author.username}`,icon_url:msg.author.avatarURL},
        title:`Card blocks — Page ${page}/${totalPages}`,
        description: finalDesc,
        color:0xcaf0f8
      };
    };

    /* 5. buttons */
    const makeButtons = (page)=>[
      {type:2,style:2,custom_id:'first',emoji:{id:'1255876906058776668',name:'fleft'},disabled:page===1},
      {type:2,style:2,custom_id:'prev',emoji:{id:'1255876721752936521',name:'left'},disabled:page===1},
      {type:2,style:2,custom_id:'next',emoji:{id:'1255876719626289223',name:'right'},disabled:page===totalPages},
      {type:2,style:2,custom_id:'last',emoji:{id:'1255876908378357771',name:'fright'},disabled:page===totalPages}
    ].map(b=>({...b}));

    /* 6. send */
    const sent = await client.createMessage(msg.channel.id,{
      embeds: [buildEmbed(currentPage)],
      components:[{type:1,components:makeButtons(currentPage)}],
      messageReference:{messageID:msg.id}
    });

    /* 7. collector */
    const handler = async (i)=>{
      if (i.message.id!==sent.id || i.member.id!==msg.author.id) return;
      await i.acknowledge();
      switch(i.data.custom_id){
        case 'first': currentPage=1; break;
        case 'prev': currentPage=Math.max(1,currentPage-1); break;
        case 'next': currentPage=Math.min(totalPages,currentPage+1); break;
        case 'last': currentPage=totalPages; break;
      }
      await i.editOriginalMessage({
        embeds: [buildEmbed(currentPage)],
        components:[{type:1,components:makeButtons(currentPage)}]
      }).catch(()=>{});
    };
    client.on('interactionCreate',handler);
    setTimeout(()=>{
      client.removeListener('interactionCreate',handler);
      sent.edit({components:[]}).catch(()=>{});
    },COLLECTOR_TTL);
  }
};