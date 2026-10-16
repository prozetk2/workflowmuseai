(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const canvas = $('#canvas');
  const edgesSvg = $('#edges');
  const runStatus = $('#runStatus');
  const backendStatus = $('#backendStatus');
  const museStatus = $('#museStatus');

  const state = {
    nodes: [],
    edges: [],
    groups: [],
    notes: [],
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectionMarquee: null,
    groupMarquee: null,
    groupDrawMode: false,
    noteDrag: null,
    connectingFrom: null,
    settings: {},
    isRunning: false,
    activeGenerationId: null,
    generationAbortController: null,
    generationRequestId: null,
    timelinePreviewToken: 0,
    timelinePreviewTimer: 0,
    timelinePlayheadFrame: 0,
    timelinePreviewPosition: 0,
    timelineExporting: false,
    timelineExportAbortController: null,
    timelineFFmpeg: null,
    timelineExportUrl: '',
    edgeFrame: 0,
    draggingWire: null,
    wireMoved: false,
    wireOrigin: null,
    pendingConnection: null,
    pointerId: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    handMode: false,
    spaceDown: false,
    panning: null,
    suppressPortClick: false,
    contextPoint: {x:120,y:100}
  };
  const undoStack=[];
  const maxUndoSteps=40;
  let lastUndoInput=null;
  let pendingNativeUndoTarget=null;

  // What an image is for when it is sent with a scene. label: shown in the app; prompt: told to Flow / Veo.
  const STATUS_TEXT={idle:'chưa chạy',queued:'đang xếp hàng',waiting:'đang chờ',running:'đang tạo',success:'xong',error:'lỗi',skipped:'bỏ qua'};
  const statusText=status=>STATUS_TEXT[status||'idle']||status;
  const IMAGE_ROLES={
    '':{label:'Tự do (ảnh tham chiếu)'},
    model:{label:'👤 Người mẫu / nhân vật',prompt:'the model/character: keep exactly this person (same face, hair, skin tone and body)'},
    outfit:{label:'👗 Trang phục',prompt:'the outfit: dress the person in exactly this outfit (same design, colors, fabric, pattern and details)'},
    product:{label:'👜 Sản phẩm',prompt:'the product: show exactly this product clearly (same shape, colors, logo and details)'},
    background:{label:'🏙️ Bối cảnh',prompt:'the location/background: use this place as the setting'},
    style:{label:'🎨 Phong cách / ánh sáng',prompt:'the style reference: match its lighting, colors and mood without copying its content'},
    startFrame:{label:'🎬 Khung đầu video',prompt:'the start frame of the video'}
  };
  const nodeDefs = {
    prompt: { title: 'Câu lệnh', outputs: [{ id: 'text', label: 'chữ', type: 'text' }] },
    negativePrompt: { title: 'Tránh (Negative)', outputs: [{ id: 'text', label: 'tránh', type: 'negative' }] },
    textAppend: { title: 'Nối thêm chữ', inputs: [{ id: 'text', label: 'chữ', type: 'text' }], outputs: [{ id: 'text', label: 'chữ', type: 'text' }] },
    textConcat: { title: 'Gộp chữ', inputs: [{ id: 'text', label: 'chữ', type: 'text' }], outputs: [{ id: 'text', label: 'chữ', type: 'text' }] },
    imageInput: { title: 'Ảnh đầu vào', outputs: [{ id: 'image', label: 'ảnh', type: 'image' }] },
    character: { title: 'Khóa nhân vật' },
    references: { title: 'Gom ảnh tham chiếu', inputs: Array.from({length:8},(_,i)=>({id:`reference${i+1}`,label:`ảnh ${i+1}`,type:'image'})), outputs: [{id:'image',label:'các ảnh',type:'image'}] },
    generateImage: {
      title: 'Tạo ảnh',
      inputs: [{ id: 'prompt', label: 'câu lệnh', type: 'text' }, { id: 'negative', label: 'tránh', type: 'negative' }, { id: 'reference', label: 'ảnh tham chiếu', type: 'image' }],
      outputs: [{ id: 'image', label: 'ảnh', type: 'image' }]
    },
    generateVideo: {
      title: 'Tạo video',
      inputs: [{ id: 'prompt', label: 'câu lệnh', type: 'text' }, { id: 'negative', label: 'tránh', type: 'negative' }, { id: 'reference', label: 'ảnh tham chiếu', type: 'image' }],
      outputs: [{ id: 'video', label: 'video', type: 'video' }, { id: 'endFrame', label: 'khung cuối', type: 'image' }]
    },
    timeline: { title: 'Timeline', inputs: Array.from({length:6},(_,i)=>({id:`clip${i+1}`,label:`clip ${i+1}`,type:'video'})), outputs: [] },
    imageResize: { title: 'Đổi kích thước ảnh', inputs: [{ id: 'image', label: 'ảnh', type: 'image' }], outputs: [{ id: 'image', label: 'ảnh', type: 'image' }] },
    preview: { title: 'Xem trước', inputs: [{ id: 'media', label: 'ảnh/video', type: 'media' }] }
  };

  function uid(prefix='id') { return `${prefix}-${crypto.randomUUID()}`; }

  function createUndoSnapshot(label,{preserveRuntime=true}={}){
    const nodes=state.nodes.map(node=>{
      const data={...(node.data||{})};
      if(data.asset&&typeof data.asset==='object')data.asset={...data.asset};
      if(data.endFrame&&typeof data.endFrame==='object')data.endFrame={...data.endFrame};
      if(Array.isArray(data.clipOrder))data.clipOrder=[...data.clipOrder];
      if(data.durations&&typeof data.durations==='object')data.durations={...data.durations};
      return{...node,data};
    });
    undoStack.push({label,preserveRuntime,nodes,edges:state.edges.map(edge=>({...edge})),groups:structuredClone(state.groups||[]),notes:structuredClone(state.notes||[]),settings:structuredClone(state.settings||{})});
    if(undoStack.length>maxUndoSteps)undoStack.shift();
  }

  function undoLastChange(){
    if(state.isRunning){setRunStatus('Hãy dừng workflow đang chạy trước khi hoàn tác.','warn');return;}
    const previous=undoStack.pop();
    if(!previous){setRunStatus('Không còn gì để hoàn tác.','warn');return;}
    if(previous.preserveRuntime){const runtimeById=new Map(state.nodes.map(node=>[node.id,{type:node.type,data:node.data||{}}]));
      for(const node of previous.nodes){const current=runtimeById.get(node.id);if(!current||current.type!==node.type)continue;const runtime=current.data;for(const key of ['status','error','asset','endFrame']){if(Object.hasOwn(runtime,key))node.data[key]=runtime[key];else delete node.data[key];}}}
    state.nodes=previous.nodes;state.edges=previous.edges;state.groups=previous.groups||[];state.notes=previous.notes||[];state.settings=previous.settings;
    state.selectedNodeIds=[];state.selectedNodeId=null;state.selectedEdgeIds=[];state.connectingFrom=null;
    normalizeSavedGraph();syncSettingsUI();render();
    setRunStatus(`Undid: ${previous.label}.`,'ok');
  }

  function duplicateNodesForDrag(ids){
    const selected=new Set(ids),copies=new Map(),newNodes=[];
    for(const id of ids){const original=nodeById(id);if(!original)continue;const copy={...original,id:uid(original.type),data:{...(original.data||{})}};copies.set(id,copy.id);newNodes.push(copy);}
    if(!newNodes.length)return[];
    const newEdges=state.edges.filter(edge=>selected.has(edge.target)).map(edge=>({...edge,id:uid('edge'),source:copies.get(edge.source)||edge.source,target:copies.get(edge.target)}));
    state.nodes.push(...newNodes);state.edges.push(...newEdges);
    const newIds=newNodes.map(node=>node.id);state.selectedNodeIds=newIds;state.selectedNodeId=newIds.at(-1)||null;
    return newIds;
  }

  function starter() {
    return {
      nodes: [
        { id: 'prompt-1', type: 'prompt', x: 90, y: 110, data: { text: 'A cinematic portrait of a futuristic Vietnamese woman, neon rain, detailed face' } },
        { id: 'gen-1', type: 'generateImage', x: 450, y: 105, data: { model: '', size: '1:1', status: 'idle' } },
        { id: 'preview-1', type: 'preview', x: 820, y: 110, data: {} }
      ],
      edges: [
        { id: 'e1', source: 'prompt-1', sourcePort: 'text', target: 'gen-1', targetPort: 'prompt' },
        { id: 'e2', source: 'gen-1', sourcePort: 'image', target: 'preview-1', targetPort: 'media' }
      ]
    };
  }

  function addNode(type, x=250 + Math.random()*220, y=160 + Math.random()*180) {
    const dockTimeline=type==='timeline'&&state.nodes.find(node=>node.type==='timeline'&&node.data?.dockOnly);
    if(dockTimeline){createUndoSnapshot('Thêm Timeline');dockTimeline.data.dockOnly=false;dockTimeline.x=x;dockTimeline.y=y;render();if($('#timelineDock').classList.contains('collapsed'))toggleTimeline();return;}
    const data = type === 'prompt' ? { text: 'Mô tả điều bạn muốn Flow tạo...' } :
      type === 'negativePrompt' ? { text: 'blurry, low quality, distorted anatomy, extra fingers, text, watermark' } :
      type === 'textAppend' ? { text: 'cinematic lighting, detailed composition' } :
      type === 'textConcat' ? { separator: ', ' } :
      type === 'imageResize' ? { width: 1024, height: 1024, fit: 'cover' } :
      type === 'generateImage' ? { model: '', size: '1:1', status: 'idle' } :
      type === 'generateVideo' ? { model: '', size: '16:9', duration: 8, continuity: false, status: 'idle' } :
      type === 'timeline' ? { clipOrder: [], durations: {} } :
      type === 'character' ? { name: `Nhân vật ${state.nodes.filter(node=>node.type==='character').length+1}`, description: '', enabled: true } : {};
    createUndoSnapshot(`Thêm ${nodeDefs[type]?.title||'node'}`);const node={ id: uid(type), type, x, y, data };state.nodes.push(node);
    if(type==='references')syncReferenceFanOut(node);else if(['generateImage','generateVideo'].includes(type)){const references=state.nodes.find(item=>item.type==='references');if(references)connectReferenceNode(references,node);}
    render();if(type==='timeline'){syncTimelineDock();if($('#timelineDock').classList.contains('collapsed'))toggleTimeline();}
  }

  function addTextNote(x=250+Math.random()*220,y=160+Math.random()*180){createUndoSnapshot('Thêm ghi chú');const note={id:uid('note'),x,y,text:'Viết ghi chú…',width:260,height:160};state.notes.push(note);render();saveState();setRunStatus('Đã thêm ghi chú.','ok');}

  function nodeById(id) { return state.nodes.find(n => n.id === id); }

  function removeNode(id) {
    const existing=nodeById(id);if(!existing)return;createUndoSnapshot(`Xoá ${nodeDefs[existing.type]?.title||'node'}`);
    state.nodes = state.nodes.filter(n => n.id !== id);
    state.edges = state.edges.filter(e => e.source !== id && e.target !== id);
    state.selectedNodeIds=state.selectedNodeIds.filter(nodeId=>nodeId!==id);if(state.selectedNodeId===id)state.selectedNodeId=state.selectedNodeIds.at(-1)||null;
    render();syncTimelineDock();
  }

  function selectNode(id,{toggle=false,add=false}={}){let ids=[...state.selectedNodeIds];if(toggle){ids=ids.includes(id)?ids.filter(item=>item!==id):[...ids,id];}else if(add){if(!ids.includes(id))ids.push(id);}else ids=[id];state.selectedNodeIds=ids;state.selectedNodeId=ids.at(-1)||null;document.querySelectorAll('.node').forEach(el=>el.classList.toggle('selected',ids.includes(el.dataset.id)));}
  function removeSelectedNodes(){const ids=new Set(state.selectedNodeIds);if(!ids.size&&state.selectedNodeId)ids.add(state.selectedNodeId);if(!ids.size)return;createUndoSnapshot(`Xoá ${ids.size} node`);state.nodes=state.nodes.filter(node=>!ids.has(node.id));state.edges=state.edges.filter(edge=>!ids.has(edge.source)&&!ids.has(edge.target));state.selectedNodeIds=[];state.selectedNodeId=null;render();saveState();}

  function portCompatible(from, targetNodeId, targetPortId) {
    const sourceNode = nodeById(from.nodeId), targetNode = nodeById(targetNodeId);
    if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;
    const out = (nodeDefs[sourceNode.type].outputs || []).find(p => p.id === from.portId);
    const input = (nodeDefs[targetNode.type].inputs || []).find(p => p.id === targetPortId);
    return Boolean(out && input && canConnectTypes(out.type,input.type));
  }

  function connectionChoices(from){
    const source=nodeById(from.nodeId),output=nodeDefs[source?.type]?.outputs?.find(port=>port.id===from.portId);if(!source||!output)return{existing:[],create:[]};
    const existing=[];for(const target of state.nodes){if(target.id===source.id)continue;for(const input of nodeDefs[target.type]?.inputs||[]){if(!portCompatible(from,target.id,input.id))continue;if(target.type==='timeline'&&getIncoming(target.id,input.id).length)continue;if(wouldCreateCycle(source.id,target.id,isMultiInput(target.type,input.id)?null:input.id))continue;existing.push({kind:'existing',targetId:target.id,targetPort:input.id,label:`${nodeDefs[target.type].title} · ${input.label}${target.data?.dockOnly?' (thanh Timeline)':''}`});}}
    const candidates=output.type==='image'?[['references','reference1','Gom ảnh tham chiếu · ảnh 1'],['preview','media','Xem trước · ảnh'],['imageResize','image','Đổi kích thước ảnh'],['generateImage','reference','Tạo ảnh · ảnh tham chiếu'],['generateVideo','reference','Tạo video · ảnh tham chiếu']]:output.type==='video'?[['preview','media','Preview · video'],['timeline','clip1','Timeline · thêm clip']]:output.type==='text'?[['generateImage','prompt','Tạo ảnh · câu lệnh'],['generateVideo','prompt','Tạo video · câu lệnh'],['textAppend','text','Nối thêm chữ'],['textConcat','text','Gộp chữ · chữ']]:output.type==='negative'?[['generateImage','negative','Tạo ảnh · tránh'],['generateVideo','negative','Tạo video · tránh']]:[];
    const create=candidates.map(([type,port,label])=>({kind:'create',type,targetPort:port,label}));return{existing,create};
  }

  function openConnectionPicker(from,x,y){
    const output=nodeDefs[nodeById(from.nodeId)?.type]?.outputs?.find(port=>port.id===from.portId),choices=connectionChoices(from),menu=$('#canvasMenu'),viewport=$('#viewport').getBoundingClientRect();
    if(!output)return;state.pendingConnection={from:{...from},x:(x-viewport.left-state.panX)/state.zoom,y:(y-viewport.top-state.panY)/state.zoom,choices:[...choices.existing,...choices.create]};menu.innerHTML='';delete menu.dataset.nodeId;delete menu.dataset.edgeId;
    const title=document.createElement('div');title.className='menu-caption';title.textContent=`Send ${output.label} · ${output.type}`;menu.appendChild(title);
    const addSection=label=>{const section=document.createElement('div');section.className='menu-caption';section.textContent=label;menu.appendChild(section);};
    const addChoice=(choice,index)=>{const button=document.createElement('button');button.type='button';button.textContent=choice.label;button.dataset.contextAction='connect-choice';button.dataset.choice=String(index);menu.appendChild(button);};
    if(choices.existing.length){addSection('Nối vào node có sẵn');choices.existing.forEach((choice,index)=>addChoice(choice,index));}
    if(choices.create.length){addSection('Tạo node phù hợp');choices.create.forEach((choice,index)=>addChoice(choice,choices.existing.length+index));}
    if(!state.pendingConnection.choices.length){const empty=document.createElement('div');empty.className='menu-caption';empty.textContent='Không có node nào nối được với đầu ra này.';menu.appendChild(empty);}
    menu.classList.remove('hidden');menu.style.left=`${Math.max(8,Math.min(x,innerWidth-260))}px`;menu.style.top=`${Math.max(8,Math.min(y,innerHeight-420))}px`;
  }

  function runConnectionChoice(index){
    const pending=state.pendingConnection,choice=pending?.choices?.[index];state.pendingConnection=null;closeCanvasMenu();
    if(!pending||!choice)return;
    if(choice.kind==='existing'){
      state.connectingFrom=pending.from;connect(choice.targetId,choice.targetPort);selectNode(choice.targetId,{add:true});setRunStatus(`Đã nối vào ${choice.label}.`,'ok');return;
    }
    const before=new Set(state.nodes.map(node=>node.id));addNode(choice.type,pending.x-135,pending.y-80);
    const target=state.nodes.find(node=>!before.has(node.id))||state.nodes.find(node=>node.type===choice.type&&node.data?.dockOnly===false&&choice.type==='timeline');if(!target||target.type!==choice.type){setRunStatus('Không tạo được node đã chọn.','error');return;}
    state.connectingFrom=pending.from;connect(target.id,choice.targetPort);selectNode(target.id);setRunStatus(`${nodeDefs[target.type].title} đã được tạo và nối vào ${choice.label.split(' · ').at(-1)}.`,'ok');
  }

  function connect(targetNodeId, targetPortId) {
    const from = state.connectingFrom;
    if (!from) return;
    if (!portCompatible(from, targetNodeId, targetPortId)) {
      setRunStatus('Hai cổng này không nối được với nhau.', 'error');
      state.connectingFrom = null;
      return;
    }
    const target=nodeById(targetNodeId),source=nodeById(from.nodeId),multi=isMultiInput(target?.type,targetPortId);
    if(wouldCreateCycle(from.nodeId,targetNodeId,multi?null:targetPortId)){setRunStatus('Nối như vậy sẽ tạo vòng lặp. Hãy nối các node theo một chiều.', 'error');state.connectingFrom=null;return;}
    const duplicate=state.edges.some(edge=>edge.source===from.nodeId&&edge.sourcePort===from.portId&&edge.target===targetNodeId&&edge.targetPort===targetPortId);
    const willReplace=!multi&&state.edges.some(edge=>edge.target===targetNodeId&&edge.targetPort===targetPortId&&!(edge.source===from.nodeId&&edge.sourcePort===from.portId));
    if(!duplicate||willReplace)createUndoSnapshot('Nối node');
    if(!multi)state.edges=state.edges.filter(edge=>!(edge.target===targetNodeId&&edge.targetPort===targetPortId));
    if(!duplicate)state.edges.push({id:uid('edge'),source:from.nodeId,sourcePort:from.portId,target:targetNodeId,targetPort:targetPortId});
    if(target?.type==='timeline'&&targetPortId.startsWith('clip')&&source?.type==='generateVideo'){
      target.data.clipOrder=target.data.clipOrder||[];if(!target.data.clipOrder.includes(source.id))target.data.clipOrder.push(source.id);
    }
    state.connectingFrom=null;
    render();
  }

  function wouldCreateCycle(sourceId,targetId,replacedPort){const pending=[targetId],seen=new Set();while(pending.length){const id=pending.pop();if(id===sourceId)return true;if(seen.has(id))continue;seen.add(id);for(const edge of state.edges){if(edge.source===id&&!(edge.target===targetId&&edge.targetPort===replacedPort))pending.push(edge.target);}}return false;}

  function nearestCompatibleInput(x,y,from){
    let best=null,bestDistance=44;
    for(const port of document.querySelectorAll('.port.in')){
      if(!portCompatible(from,port.dataset.node,port.dataset.port))continue;
      const rect=port.getBoundingClientRect(),distance=Math.hypot(x-(rect.left+rect.width/2),y-(rect.top+rect.height/2));
      if(distance<bestDistance){best=port;bestDistance=distance;}
    }
    return best;
  }
  function canConnectTypes(outputType,inputType){return outputType===inputType||inputType==='media'&&['image','video'].includes(outputType);}
  function isMultiInput(nodeType,portId){return ['generateImage','generateVideo'].includes(nodeType)&&['prompt','reference'].includes(portId)||nodeType==='references'&&portId.startsWith('reference')||nodeType==='textConcat'&&portId==='text';}
  function connectReferenceNode(references,generator){if(!references||!generator||!['generateImage','generateVideo'].includes(generator.type))return;const duplicate=state.edges.some(edge=>edge.source===references.id&&edge.sourcePort==='image'&&edge.target===generator.id&&edge.targetPort==='reference');if(!duplicate)state.edges.push({id:uid('edge'),source:references.id,sourcePort:'image',target:generator.id,targetPort:'reference'});}
  function syncReferenceFanOut(references){for(const generator of state.nodes.filter(node=>['generateImage','generateVideo'].includes(node.type)))connectReferenceNode(references,generator);}

  function makeNode(type,x,y){
    const data=type==='prompt'?{text:'Mô tả điều bạn muốn Flow tạo...'}:type==='negativePrompt'?{text:'blurry, low quality, distorted anatomy, extra fingers, text, watermark'}:type==='imageInput'?{}:type==='generateVideo'?{model:'',size:'16:9',duration:8,continuity:false,status:'idle'}:{};
    return{id:uid(type),type,x,y,data};
  }

  function scriptField(section,label,nextLabels){
    const startPattern=new RegExp(`^\\s*${label}\\s*:\\s*`,'im'),match=startPattern.exec(section);if(!match)return'';
    const start=match.index+match[0].length,tail=section.slice(start),stop=nextLabels.length?new RegExp(`^\\s*(?:${nextLabels.join('|')})\\s*:`,'im').exec(tail):null;
    return tail.slice(0,stop?stop.index:tail.length).trim();
  }
  function parseSceneScript(text){
    const heading=/^\s*CẢNH\s+(\d+)\s*\(([^)]*)\)\s*:\s*(.*?)\s*$/gim,matches=[...text.matchAll(heading)];
    return matches.map((match,index)=>{
      const body=text.slice(match.index+match[0].length,matches[index+1]?.index??text.length),imagePrompt=scriptField(body,'Prompt\\s+ảnh',['Prompt\\s+video','Audio']),videoPrompt=scriptField(body,'Prompt\\s+video',['Audio']),audio=scriptField(body,'Audio',[]),range=match[2].match(/(\d+):(\d{2})\s*[–—-]\s*(\d+):(\d{2})/);
      const seconds=range?(Number(range[3])*60+Number(range[4]))-(Number(range[1])*60+Number(range[2])):0;
      const ratio=(imagePrompt+' '+videoPrompt).match(/\b(9:16|16:9|1:1|4:3|3:4)\b/);
      return{number:Number(match[1]),title:match[3].trim(),imagePrompt,videoPrompt:[videoPrompt,audio?`Audio direction: ${audio}`:''].filter(Boolean).join('\n\n'),seconds:seconds>0?seconds:6,size:ratio?.[1]||'9:16'};
    }).filter(scene=>scene.imagePrompt||scene.videoPrompt);
  }
  // Veo makes 16:9 or 9:16 video only.
  function videoAspect(size){return ['16:9','4:3'].includes(size)?'16:9':'9:16';}
  function buildSceneNodesFromScript(){
    const status=$('#scriptImportStatus'),scenes=parseSceneScript($('#scriptInput').value);
    if(!scenes.length){status.className='error';status.textContent='Không tìm thấy cảnh nào. Hãy dùng tiêu đề kiểu “CẢNH 1 (0:00–0:07): Tên cảnh” và thêm Prompt ảnh hoặc Prompt video.';return;}
    createUndoSnapshot('Tạo node từ kịch bản');const baseY=Math.max(40,...state.nodes.filter(node=>!node.data?.dockOnly).map(node=>node.y+360)),createdVideos=[];let made=0;
    scenes.forEach((scene,index)=>{
      const column=index%4,row=Math.floor(index/4),x=80+column*650,y=baseY+row*1100,label=`Scene ${scene.number}${scene.title?`: ${scene.title}`:''}`;
      let imageNode=null,videoNode=null;
      if(scene.imagePrompt){const prompt=makeNode('prompt',x,y);prompt.data={text:scene.imagePrompt,sceneLabel:label};const image=makeNode('generateImage',x+330,y);image.data={model:'',size:scene.size,status:'idle',outputRole:'startFrame',sceneLabel:label};state.nodes.push(prompt,image);state.edges.push({id:uid('edge'),source:prompt.id,sourcePort:'text',target:image.id,targetPort:'prompt'});imageNode=image;made+=2;}
      if(scene.videoPrompt){const prompt=makeNode('prompt',x,y+540);prompt.data={text:scene.videoPrompt,sceneLabel:label};const requestedDuration=[4,6,8].reduce((best,value)=>Math.abs(value-scene.seconds)<Math.abs(best-scene.seconds)?value:best,8);videoNode=makeNode('generateVideo',x+330,y+540);videoNode.data={model:'',size:videoAspect(scene.size),duration:requestedDuration,referenceMode:'firstFrame',continuity:createdVideos.length>0,status:'idle',sceneLabel:label};state.nodes.push(prompt,videoNode);state.edges.push({id:uid('edge'),source:prompt.id,sourcePort:'text',target:videoNode.id,targetPort:'prompt'});if(imageNode)state.edges.push({id:uid('edge'),source:imageNode.id,sourcePort:'image',target:videoNode.id,targetPort:'reference'});made+=2;createdVideos.push({node:videoNode,seconds:scene.seconds});}
    });
    let references=state.nodes.find(node=>node.type==='references');if(!references){const minX=Math.min(80,...state.nodes.filter(node=>!node.data?.dockOnly).map(node=>node.x));references=makeNode('references',minX-360,baseY);references.data={};state.nodes.push(references);made++;}syncReferenceFanOut(references);
    const timeline=ensureDockTimeline();timeline.data.clipOrder=createdVideos.map(item=>item.node.id);timeline.data.durations=timeline.data.durations||{};createdVideos.forEach(({node,seconds})=>{timeline.data.durations[node.id]=seconds;});
    $('#scriptModal').classList.add('hidden');render();saveState();if($('#timelineDock').classList.contains('collapsed'))toggleTimeline();
    setRunStatus(`Đã tạo ${scenes.length} cảnh · ${made} node · ${createdVideos.length} clip video đã xếp vào Timeline.`,'ok');
  }

  function screenToCanvas(x,y){const rect=$('#viewport').getBoundingClientRect();return{x:x-rect.left,y:y-rect.top};}

  function startWire(e,nodeId,portId){
    if(e.button!==undefined&&e.button!==0)return;
    e.preventDefault();e.stopPropagation();
    state.draggingWire={nodeId,portId};state.connectingFrom={nodeId,portId};state.wireMoved=false;
    const sourceForCapture=nodeById(nodeId);
    if(!(sourceForCapture?.type==='generateVideo'&&portId==='video'))try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
    state.wirePointer={x:e.clientX,y:e.clientY};state.wireOrigin={x:e.clientX,y:e.clientY};
    document.querySelectorAll('.port.in').forEach(port=>{if(portCompatible({nodeId,portId},port.dataset.node,port.dataset.port))port.classList.add('wire-compatible');});
  }

  function startWireFromInput(e,nodeId,portId,portType){
    if(e.button!==undefined&&e.button!==0)return;e.preventDefault();e.stopPropagation();state.draggingWire={nodeId,portId,direction:'in',portType};state.wireMoved=false;state.wirePointer={x:e.clientX,y:e.clientY};state.wireOrigin={x:e.clientX,y:e.clientY};
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}
    document.querySelectorAll('.port.out').forEach(port=>{if(portCompatible({nodeId:port.dataset.node,portId:port.dataset.port},nodeId,portId))port.classList.add('wire-compatible');});
  }

  function onWireMove(e){
    if(!state.draggingWire)return;
    if(state.wireOrigin&&Math.hypot(e.clientX-state.wireOrigin.x,e.clientY-state.wireOrigin.y)>5)state.wireMoved=true;
      const source=nodeById(state.draggingWire.nodeId),dock=$('#timelineDock'),overDock=source?.type==='generateVideo'&&state.draggingWire.portId==='video'&&(()=>{const r=dock.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;})();
    dock.classList.toggle('wire-drop-target',Boolean(overDock));
    if(overDock&&dock.classList.contains('collapsed'))toggleTimeline();
    state.wirePointer={x:e.clientX,y:e.clientY};scheduleDrawEdges();
  }

  function onWireUp(e){
    if(!state.draggingWire)return;
    const from=state.draggingWire,moved=state.wireMoved,source=nodeById(from.nodeId),dock=$('#timelineDock'),r=dock.getBoundingClientRect(),droppedOnTimeline=source?.type==='generateVideo'&&from.portId==='video'&&e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
    state.draggingWire=null;state.wirePointer=null;state.wireOrigin=null;
    dock.classList.remove('wire-drop-target');
    document.querySelectorAll('.wire-compatible').forEach(port=>port.classList.remove('wire-compatible'));
    if(moved&&from.direction==='in'){
      const output=nearestCompatibleOutput(e.clientX,e.clientY,from);
      if(output){state.connectingFrom={nodeId:output.dataset.node,portId:output.dataset.port};connect(from.nodeId,from.portId);}
      else{const rect=$('#viewport').getBoundingClientRect(),emptyCanvas=!document.elementFromPoint(e.clientX,e.clientY)?.closest('.node'),inside=e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom,type=from.portType==='negative'?'negativePrompt':'prompt';if(inside&&emptyCanvas){addNode(type,(e.clientX-rect.left-state.panX)/state.zoom-135,(e.clientY-rect.top-state.panY)/state.zoom-80);const created=state.nodes.at(-1);state.connectingFrom={nodeId:created.id,portId:'text'};connect(from.nodeId,from.portId);setRunStatus(`Đã tạo và nối ${nodeDefs[type].title}.`,'ok');}else setRunStatus('Thả vào một cổng ra hoặc chỗ trống trên canvas để tạo node câu lệnh.','warn');}
      state.suppressPortClick=true;setTimeout(()=>state.suppressPortClick=false,80);scheduleDrawEdges();return;
    }
    if(moved){
      if(droppedOnTimeline){addTimelineClip(ensureDockTimeline(),source.id);state.connectingFrom=null;state.suppressPortClick=true;setTimeout(()=>state.suppressPortClick=false,80);scheduleDrawEdges();return;}
      const hit=nearestCompatibleInput(e.clientX,e.clientY,from);
      if(hit){state.connectingFrom=from;connect(hit.dataset.node,hit.dataset.port);}
      else {const rect=$('#viewport').getBoundingClientRect(),inside=e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom;if(inside)openConnectionPicker(from,e.clientX,e.clientY);else{state.connectingFrom=null;setRunStatus('Thả đầu ra lên canvas để chọn node phù hợp.','warn');}}
      state.suppressPortClick=true;setTimeout(()=>state.suppressPortClick=false,80);
    }
    scheduleDrawEdges();
  }

  function nearestInputPort(x,y){
    const direct=document.elementsFromPoint(x,y).map(el=>el.closest?.('.port.in')).filter(Boolean);
    const candidates=[...new Set([...direct,...document.querySelectorAll('.port.in.wire-compatible')])];
    let best=null,distance=Infinity;
    for(const port of candidates){if(!port.classList.contains('wire-compatible'))continue;const r=port.getBoundingClientRect(),d=Math.hypot(x-(r.left+r.width/2),y-(r.top+r.height/2));if(d<distance){best=port;distance=d;}}
    return best&&distance<=38?best:null;
  }
  function nearestCompatibleOutput(x,y,target){let best=null,distance=44;for(const port of document.querySelectorAll('.port.out')){if(!portCompatible({nodeId:port.dataset.node,portId:port.dataset.port},target.nodeId,target.portId))continue;const rect=port.getBoundingClientRect(),d=Math.hypot(x-(rect.left+rect.width/2),y-(rect.top+rect.height/2));if(d<distance){best=port;distance=d;}}return best;}
  function normalizeSavedGraph(){
    const knownNodes=new Set(Object.keys(nodeDefs));
    state.notes=Array.isArray(state.notes)?state.notes:[];
    for(const legacy of state.nodes.filter(node=>node?.type==='text'))if(!state.notes.some(note=>note.id===`note-${legacy.id}`))state.notes.push({id:`note-${legacy.id}`,x:Number(legacy.x)||0,y:Number(legacy.y)||0,text:String(legacy.data?.text||''),width:260,height:160});
    state.nodes=state.nodes.filter(node=>node?.type!=='text');
    const seenNodeIds=new Set();
    state.nodes=state.nodes.filter(node=>{if(!node||!knownNodes.has(node.type)||typeof node.id!=='string'||seenNodeIds.has(node.id))return false;seenNodeIds.add(node.id);return true;});
    for(const node of state.nodes)if(!node.data||typeof node.data!=='object'||Array.isArray(node.data))node.data={};
    for(const node of state.nodes)if(node.type==='timeline'){
      node.data.clipOrder=Array.isArray(node.data.clipOrder)?[...new Set(node.data.clipOrder.filter(id=>state.nodes.some(item=>item.id===id&&item.type==='generateVideo')))]:[];
      if(!node.data.durations||typeof node.data.durations!=='object'||Array.isArray(node.data.durations))node.data.durations={};
    }
    const normalized=[];
    for(const raw of state.edges){
      if(!raw||typeof raw.source!=='string'||typeof raw.target!=='string')continue;
      const source=nodeById(raw.source),target=nodeById(raw.target);
      if(!source||!target||source.id===target.id)continue;
      const outputs=nodeDefs[source.type].outputs||[],inputs=nodeDefs[target.type].inputs||[];
      // Only infer port names for old single-port edges; never guess between semantic ports.
      const sourcePort=raw.sourcePort|| (outputs.length===1?outputs[0].id:null);
      const sourceDef=outputs.find(port=>port.id===sourcePort);
      const compatibleInputs=inputs.filter(port=>sourceDef&&canConnectTypes(sourceDef.type,port.type));
      const legacyMergePort=target.type==='textConcat'&&['a','b'].includes(raw.targetPort);
      const targetPort=legacyMergePort?'text':raw.targetPort|| (compatibleInputs.length===1?compatibleInputs[0].id:null);
      const inputDef=inputs.find(port=>port.id===targetPort);
      if(!sourceDef||!inputDef||!canConnectTypes(sourceDef.type,inputDef.type))continue;
      normalized.push({...raw,id:raw.id||uid('edge'),sourcePort,targetPort});
    }
    // Normal inputs are single-source; prompt and reference inputs retain distinct sources.
    const occupied=new Set(),unique=[];
    for(let index=normalized.length-1;index>=0;index--){const edge=normalized[index],key=isMultiInput(nodeById(edge.target)?.type,edge.targetPort)?`${edge.target}:${edge.targetPort}:${edge.source}:${edge.sourcePort}`:`${edge.target}:${edge.targetPort}`;if(occupied.has(key))continue;occupied.add(key);unique.push(edge);}
    state.edges=unique.reverse();
    state.groups=Array.isArray(state.groups)?state.groups.filter(group=>group&&Number.isFinite(group.x)&&Number.isFinite(group.y)&&Number.isFinite(group.width)&&Number.isFinite(group.height)&&group.width>0&&group.height>0).map(group=>({...group,id:typeof group.id==='string'?group.id:uid('group'),name:String(group.name||'Group'),nodeIds:Array.isArray(group.nodeIds)?group.nodeIds.filter(id=>seenNodeIds.has(id)):[]})):[];
  }
  function roleSelect(n,field,caption){
    const wrap=document.createElement('label');wrap.className='role-select';wrap.onpointerdown=event=>event.stopPropagation();
    const select=document.createElement('select');for(const [value,role] of Object.entries(IMAGE_ROLES)){const option=document.createElement('option');option.value=value;option.textContent=role.label;select.appendChild(option);}
    select.value=IMAGE_ROLES[n.data[field]]?n.data[field]||'':'';select.onchange=()=>{n.data[field]=select.value;scheduleAutoSave();render();};
    wrap.append(caption,select);return wrap;
  }
  function characterToggle(n){
    if(!state.nodes.some(node=>node.type==='character'))return null;
    const label=document.createElement('label');label.className='continuity-toggle character-toggle';label.onpointerdown=event=>event.stopPropagation();
    const check=document.createElement('input');check.type='checkbox';check.checked=n.data.useCharacters!==false;check.onchange=()=>{n.data.useCharacters=check.checked;scheduleAutoSave();};
    label.append(check,document.createTextNode('🔒 Dùng khóa nhân vật'));return label;
  }
  function renderNode(n) {
    const el = document.createElement('section');
    el.className = `node ${['generateImage','generateVideo'].includes(n.type) ? 'generate' : ''} ${n.type==='timeline'?'timeline-node':''} ${state.selectedNodeIds.includes(n.id)||state.selectedNodeId===n.id ? 'selected' : ''}`;
    el.dataset.id = n.id;
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    const head = document.createElement('div');
    head.className = 'node-header';
    const title=document.createElement('span');title.className='node-title';title.textContent=n.data.customName||`${nodeDefs[n.type].title}${n.type==='imageInput'&&n.data.role&&IMAGE_ROLES[n.data.role]?` · ${IMAGE_ROLES[n.data.role].label.replace(/^\S+\s/,'')}`:''}${n.data.sceneLabel?` · ${n.data.sceneLabel}`:''}`;title.title=title.textContent;const close=document.createElement('span');close.className='node-close';close.title='Xoá';close.textContent='×';head.append(title,close);
    head.querySelector('.node-close').onclick = (e) => { e.stopPropagation(); removeNode(n.id); };
    setupDrag(head, n, el);
    el.appendChild(head);

    const body = document.createElement('div');
    body.className = 'node-body';

    if (['prompt','negativePrompt','textAppend'].includes(n.type)) {
      const ta = document.createElement('textarea');
      ta.value = n.data.text || '';
      ta.oninput = () => n.data.text = ta.value;
      body.appendChild(ta);
      if(n.type==='negativePrompt'){const hint=document.createElement('div');hint.className='hint';hint.textContent='Nối vào cổng “tránh” của node Tạo ảnh hoặc Tạo video.';body.appendChild(hint);}
      if(n.type==='textAppend'){const hint=document.createElement('div');hint.className='hint';hint.textContent='Nối đoạn chữ này vào sau câu lệnh đi vào.';body.appendChild(hint);}
    }

    if(n.type==='textConcat'){
      const separator=document.createElement('input');separator.value=n.data.separator??', ';separator.placeholder='Dấu ngăn cách';separator.oninput=()=>n.data.separator=separator.value;body.append('Gộp các đoạn chữ, ngăn cách bằng:',separator);
    }

    if(n.type==='character'){
      // Character Lock: one face/outfit kept in every Generate Image / Generate Video node of the workflow.
      const stop=element=>{element.onpointerdown=event=>event.stopPropagation();return element;};
      const name=stop(document.createElement('input'));name.value=n.data.name||'';name.placeholder='Tên nhân vật (vd: Lan)';name.oninput=()=>{n.data.name=name.value;scheduleAutoSave();};
      const description=stop(document.createElement('textarea'));description.className='character-description';description.value=n.data.description||'';description.placeholder='Ngoại hình cố định: tuổi, khuôn mặt, tóc, dáng người, trang phục… (vd: cô gái Việt 25 tuổi, tóc đen dài, áo dài đỏ)';description.oninput=()=>{n.data.description=description.value;scheduleAutoSave();};
      body.append(name,description);
      if(n.data.localDataUrl){const img=document.createElement('img');img.src=n.data.localDataUrl;img.alt='Ảnh nhân vật';body.appendChild(img);}
      else{const empty=document.createElement('div');empty.className='empty character-empty';empty.textContent='Thả / dán ảnh nhân vật vào đây';body.appendChild(empty);}
      const label=document.createElement('label');label.className='small-btn';label.textContent=n.data.localDataUrl?'Đổi ảnh':'Chọn ảnh nhân vật';const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=()=>{const file=input.files&&input.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{createUndoSnapshot('Đổi ảnh nhân vật');n.data.localDataUrl=String(reader.result||'');render();saveState();};reader.readAsDataURL(file);};label.appendChild(input);body.appendChild(label);
      const toggle=document.createElement('label');toggle.className='continuity-toggle';toggle.onpointerdown=event=>event.stopPropagation();const check=document.createElement('input');check.type='checkbox';check.checked=n.data.enabled!==false;check.onchange=()=>{n.data.enabled=check.checked;scheduleAutoSave();render();};toggle.append(check,document.createTextNode('Khóa nhân vật này cho mọi cảnh'));body.appendChild(toggle);
      const scenes=state.nodes.filter(node=>['generateImage','generateVideo'].includes(node.type)&&node.data.useCharacters!==false).length;
      const hint=document.createElement('div');hint.className='hint';hint.textContent=n.data.enabled===false?'Đang tắt: không gửi nhân vật này.':`Gửi ảnh + mô tả này kèm ${scenes} cảnh Tạo ảnh/Tạo video (làm ảnh tham chiếu, không làm khung đầu).`;body.appendChild(hint);
    }

    if (n.type === 'imageInput') {
      if (n.data.localDataUrl) {
        const img = document.createElement('img'); img.src = n.data.localDataUrl; body.appendChild(img);
      } else {
        const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Chưa có ảnh: thả / dán ảnh vào đây'; body.appendChild(empty);
      }
      const label = document.createElement('label');
      label.className = 'small-btn'; label.textContent = n.data.localDataUrl ? 'Đổi ảnh' : 'Chọn ảnh';
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files && input.files[0]; if (!f) return;
        const r = new FileReader(); r.onload = () => { n.data.localDataUrl = String(r.result || ''); render(); }; r.readAsDataURL(f);
      };
      label.appendChild(input); body.appendChild(label);
      body.appendChild(roleSelect(n,'role','Ảnh này là:'));
      const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = 'Nối cổng “ảnh” sang “ảnh tham chiếu” của Tạo ảnh / Tạo video. Có thể nối 2–3 ảnh vào cùng một cảnh.'; body.appendChild(hint);
    }

    if(n.type==='references'){
      const incoming=(nodeDefs.references.inputs||[]).reduce((count,input)=>count+getIncoming(n.id,input.id).length,0),badge=document.createElement('span');badge.className='ref-badge';badge.textContent=`Đã nối ${incoming} ảnh`;body.appendChild(badge);
      const list=document.createElement('div');list.className='references-input-list';(nodeDefs.references.inputs||[]).forEach(input=>{const row=document.createElement('div');row.textContent=`${input.label} · nối ảnh vào`;list.appendChild(row);});body.appendChild(list);
      const hint=document.createElement('div');hint.className='hint';hint.textContent='Mọi ảnh nối vào đây được gửi cho mọi node Tạo ảnh và Tạo video nối với nó.';body.appendChild(hint);
    }

    if (n.type === 'generateImage') {
      const controls = document.createElement('div'); controls.className = 'gen-controls';
      const size = document.createElement('select');
      [['1:1','Vuông 1:1'],['16:9','Ngang 16:9'],['9:16','Dọc 9:16'],['4:3','Ngang 4:3'],['3:4','Dọc 3:4']].forEach(([v,label]) => { const o=document.createElement('option'); o.value=v; o.textContent=label; size.appendChild(o); });
      size.value = ['1:1','16:9','9:16','4:3','3:4'].includes(n.data.size)?n.data.size:'1:1'; size.onchange = () => n.data.size = size.value;
      const model = document.createElement('input'); model.value = n.data.model || ''; model.placeholder = 'Model (trống = theo Cài đặt)'; model.oninput = () => n.data.model = model.value;
      controls.append(size, model); body.appendChild(controls);
      body.appendChild(roleSelect(n,'outputRole','Khi nối sang cảnh khác, ảnh kết quả là:'));
      const imageCharacter=characterToggle(n);if(imageCharacter)body.appendChild(imageCharacter);
      const st = document.createElement('div'); st.className = `status ${n.data.status || 'idle'}`; st.textContent = `${statusText(n.data.status)}${n.data.error ? ' · ' + n.data.error : ''}`; body.appendChild(st);
      if(n.data.asset?.width&&n.data.asset?.height){const dimensions=document.createElement('div');dimensions.className=`hint ${n.data.asset.sizeMismatch?'error':''}`;dimensions.textContent=`Yêu cầu ${n.data.asset.requestedSize||n.data.size} · nhận ${n.data.asset.width} × ${n.data.asset.height}${n.data.asset.sizeMismatch?' (khác tỉ lệ)':''}`;body.appendChild(dimensions);}
      if (n.data.asset?.url) { const a=document.createElement('a'); a.href=n.data.asset.url; a.target='_blank'; a.className='image-link'; const img=document.createElement('img'); img.src=n.data.asset.url; a.appendChild(img); body.appendChild(a); }
      const promptCount=getIncoming(n.id,'prompt').length;if(promptCount>1){const b=document.createElement('span');b.className='ref-badge';b.textContent=`Đã gộp ${promptCount} câu lệnh`;body.appendChild(b);}
      const referenceCount=getIncoming(n.id,'reference').length;if(referenceCount){const b=document.createElement('span');b.className='ref-badge';b.textContent=`Đã nối ${referenceCount} ảnh tham chiếu`;body.appendChild(b);}
      body.appendChild(createNodeRunActions(n));
    }

    if(n.type==='generateVideo'){
      const controls=document.createElement('div');controls.className='gen-controls video-controls';
      const ratio=document.createElement('select');[['16:9','Ngang 16:9'],['9:16','Dọc 9:16']].forEach(([v,label])=>{const o=document.createElement('option');o.value=v;o.textContent=label;ratio.appendChild(o);});ratio.value=['16:9','9:16'].includes(n.data.size)?n.data.size:'16:9';ratio.onchange=()=>n.data.size=ratio.value;
      const duration=document.createElement('select');[4,6,8].forEach(v=>{const o=document.createElement('option');o.value=String(v);o.textContent=`${v}s`;duration.appendChild(o);});duration.value=String([4,6,8].includes(Number(n.data.duration))?Number(n.data.duration):8);duration.onchange=()=>n.data.duration=Number(duration.value);
      const model=document.createElement('input');model.value=n.data.model||'';model.placeholder='Model (trống = theo Cài đặt)';model.title='Flow: tên model như trong menu của Flow (vd: Omni 1.1 Flash). Gemini API: mã model như veo-3.1-fast-generate-preview.';model.oninput=()=>n.data.model=model.value;const referenceMode=document.createElement('select');referenceMode.title='Ảnh không có vai trò sẽ được gửi thế nào';[['firstFrame','Ảnh → khung đầu'],['ingredients','Ảnh → tham chiếu']].forEach(([v,label])=>{const o=document.createElement('option');o.value=v;o.textContent=label;referenceMode.appendChild(o);});referenceMode.value=n.data.referenceMode==='ingredients'?'ingredients':'firstFrame';referenceMode.onchange=()=>{n.data.referenceMode=referenceMode.value;scheduleAutoSave();};controls.append(ratio,duration,model,referenceMode);body.appendChild(controls);
      const continuityLabel=document.createElement('label');continuityLabel.className='continuity-toggle';continuityLabel.htmlFor=`continuity-${n.id}`;continuityLabel.onpointerdown=event=>event.stopPropagation();const continuity=document.createElement('input');continuity.id=`continuity-${n.id}`;continuity.type='checkbox';continuity.checked=Boolean(n.data.continuity);continuity.onchange=()=>{n.data.continuity=continuity.checked;scheduleAutoSave();};continuityLabel.append(continuity,document.createTextNode('Dùng khung cuối của clip trước làm khung đầu'));body.appendChild(continuityLabel);
      const videoCharacter=characterToggle(n);if(videoCharacter)body.appendChild(videoCharacter);
      if(n.data.endFrame?.url){const frame=document.createElement('img');frame.className='end-frame-thumb';frame.src=n.data.endFrame.url;frame.alt='Extracted final frame for continuity';frame.title='Khung cuối video · nối “khung cuối” sang ảnh tham chiếu của video sau';body.appendChild(frame);}
      const status=document.createElement('div');status.className=`status ${n.data.status||'idle'}`;status.textContent=`${statusText(n.data.status)}${n.data.error?' · '+n.data.error:''}`;body.appendChild(status);
      if(n.data.asset?.width&&n.data.asset?.height){const dimensions=document.createElement('div');dimensions.className=`hint ${n.data.asset.sizeMismatch?'error':''}`;dimensions.textContent=`Yêu cầu ${n.data.asset.requestedSize||n.data.size} · nhận ${n.data.asset.width} × ${n.data.asset.height}${n.data.asset.sizeMismatch?' (khác tỉ lệ)':''}`;body.appendChild(dimensions);}
      if(n.data.asset?.url){const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=n.data.asset.url;body.appendChild(video);}
      const timelineDrag=document.createElement('button');timelineDrag.type='button';timelineDrag.className='video-timeline-drag';timelineDrag.draggable=true;timelineDrag.innerHTML='<span aria-hidden="true">⠿</span> Kéo vào Timeline';timelineDrag.title='Kéo kết quả này vào Timeline';timelineDrag.ondragstart=event=>{event.dataTransfer.setData('application/x-museflow-video-node',n.id);event.dataTransfer.setData('text/plain',n.id);event.dataTransfer.effectAllowed='copy';};timelineDrag.onclick=event=>{event.stopPropagation();addTimelineClip(ensureDockTimeline(),n.id);};body.appendChild(timelineDrag);
      body.appendChild(createNodeRunActions(n));
    }
    if(n.type==='timeline')renderTimelineBody(n,body);

    if(n.type==='imageResize'){
      const incoming=sourceFor(getIncoming(n.id,'image')[0]);
      const imageUrl=incoming?.data?.localDataUrl||incoming?.data?.asset?.url||'';
      const width=document.createElement('input');width.type='number';width.min='1';width.max='4096';width.value=n.data.width||1024;width.title='Rộng';width.oninput=()=>n.data.width=clampDimension(width.value);
      const height=document.createElement('input');height.type='number';height.min='1';height.max='4096';height.value=n.data.height||1024;height.title='Cao';height.oninput=()=>n.data.height=clampDimension(height.value);
      const fit=document.createElement('select');[['cover','Cắt cho đầy khung'],['contain','Vừa trong khung'],['stretch','Kéo giãn']].forEach(([v,label])=>{const o=document.createElement('option');o.value=v;o.textContent=label;fit.appendChild(o);});fit.value=n.data.fit||'cover';fit.onchange=()=>n.data.fit=fit.value;
      body.append(width,height,fit);
      const out=document.createElement('canvas');out.className='resize-preview';
      if(imageUrl){const image=new Image();image.onload=()=>drawResized(image,out,n.data);image.src=imageUrl;}
      body.appendChild(out);
      const download=document.createElement('button');download.type='button';download.className='small-btn';download.textContent='Tải ảnh đã đổi kích thước';download.disabled=!imageUrl;download.onclick=()=>{out.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`thekey-${n.data.width}x${n.data.height}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);});};body.appendChild(download);
    }

    if (n.type === 'preview') {
      if (n.data.asset?.url) { if(n.data.asset.kind==='video'){const video=document.createElement('video');video.controls=true;video.src=n.data.asset.url;body.appendChild(video);}else{const a=document.createElement('a');a.href=n.data.asset.url;a.target='_blank';const img=document.createElement('img');img.src=n.data.asset.url;a.appendChild(img);body.appendChild(a);} }
      else { const empty=document.createElement('div'); empty.className='empty preview-empty'; empty.textContent='Chạy tất cả'; body.appendChild(empty); }
    }

    el.appendChild(body);
    addPorts(el, n);
    el.onmousedown = event => {if(event.target.closest('button,input,textarea,select,.port,.node-header'))return;selectNode(n.id,{toggle:event.shiftKey||event.ctrlKey||event.metaKey});};
    return el;
  }

  function createNodeRunActions(node){
    const actions=document.createElement('div');actions.className='node-generation-actions';
    const button=document.createElement('button');button.type='button';button.className='node-run-button primary';
    if(node.data.status==='running'){
      button.classList.add('stop');button.textContent='■ Dừng';button.disabled=false;button.title='Dừng lần tạo này';button.dataset.stopGeneration=node.id;
    }else{
      button.textContent=`▶ Tạo ${node.type==='generateVideo'?'video':'ảnh'}`;button.disabled=state.isRunning;
      button.onclick=event=>{event.stopPropagation();runSingleNode(node.id);};
    }
    actions.appendChild(button);
    if(node.type==='generateVideo'){
      const again=document.createElement('button');again.type='button';again.className='node-run-button again';again.textContent='↻ Tạo lại';again.title='Tạo lại với cùng câu lệnh và ảnh';again.disabled=state.isRunning;
      again.onclick=event=>{event.stopPropagation();executeGenerationNode(node.id,{again:true});};actions.appendChild(again);
    }
    return actions;
  }

  function addPorts(el, n) {
    const def = nodeDefs[n.type];
    (def.inputs || []).forEach((p, i) => {
      const y = ['generateImage','generateVideo'].includes(n.type) ? 52+i*26 : n.type==='timeline'?58+i*42:68+i*42;
      const port = document.createElement('div'); port.className='port in'; port.dataset.node=n.id; port.dataset.port=p.id;port.dataset.type=p.type; port.style.top=`${y}px`; port.title=`Input: ${p.label} (${p.type})`;
      if(p.type==='text'||p.type==='negative')port.onpointerdown=e=>startWireFromInput(e,n.id,p.id,p.type);
      port.ondragover=e=>{if(state.connectingFrom&&portCompatible(state.connectingFrom,n.id,p.id)){e.preventDefault();port.classList.add('wire-compatible');}};
      port.onclick = (e) => { e.stopPropagation(); if(state.suppressPortClick)return; if(state.connectingFrom)connect(n.id,p.id); else setRunStatus('Hãy bắt đầu từ một cổng ra phù hợp rồi bấm vào cổng vào này.','warn'); };
      const label=document.createElement('span'); label.className='port-label left'; label.style.top=`${y-1}px`; const count=isMultiInput(n.type,p.id)?getIncoming(n.id,p.id).length:0;label.textContent=count?`${p.label} · ${count}`:p.label;if(count)port.title=n.type==='textConcat'?`Nguồn chữ (đã nối ${count})`:p.id==='prompt'?`Câu lệnh (đã nối ${count})`:`Ảnh tham chiếu (đã nối ${count})`;el.append(label,port);
    });
    (def.outputs || []).forEach((p, i) => {
      const y = ['prompt','negativePrompt','textAppend'].includes(n.type) ? 80 : n.type==='generateVideo'?82+i*30:['imageInput','generateImage'].includes(n.type)?82:66+i*42;
      const port=document.createElement('div'); port.className='port out'; port.dataset.node=n.id; port.dataset.port=p.id;port.dataset.type=p.type; port.style.top=`${y}px`; port.title=`Output: ${p.label} (${p.type})`;
      port.onpointerdown=e=>startWire(e,n.id,p.id);
      if(n.type==='generateVideo'){port.classList.add('video-output-port');port.title=p.id==='endFrame'?'Nối khung cuối này sang ảnh tham chiếu của video sau':'Nối video sang Timeline hoặc cổng phù hợp khác';}
      port.onmousedown=e=>{if(e.button===0){e.stopPropagation();state.connectingFrom={nodeId:n.id,portId:p.id};setRunStatus(`Đang nối ${p.type}: bấm vào một cổng vào phù hợp.`,'warn');}};
      port.onclick=(e)=>{e.stopPropagation();if(state.suppressPortClick)return;if(!state.draggingWire){state.connectingFrom={nodeId:n.id,portId:p.id};setRunStatus(`Đang nối ${p.type}: bấm hoặc kéo tới một cổng vào phù hợp.`,'warn');}};
      const label=document.createElement('span'); label.className='port-label right'; label.style.top=`${y-1}px`; label.textContent=p.label; el.append(label,port);
    });
  }

  function setupDrag(handle, n, el) {
    handle.onmousedown = (e) => {
      if(state.handMode||state.spaceDown)return;
      if (e.target.classList.contains('node-close')) return;
      e.preventDefault();
      const altCopy=e.altKey,modified=e.shiftKey||e.ctrlKey||e.metaKey,wasSelected=state.selectedNodeIds.includes(n.id);if(modified){selectNode(n.id,{toggle:true});if(wasSelected)return;}else if(!wasSelected)selectNode(n.id);
      const sx=e.clientX, sy=e.clientY,zoom=state.zoom;let group=state.selectedNodeIds.includes(n.id)?[...state.selectedNodeIds]:[n.id],origins=[],copied=false,undoRecorded=false,moved=false;
      const getOrigins=()=>group.map(id=>{const node=nodeById(id);return node&&{id:node.id,x:node.x,y:node.y};}).filter(Boolean);origins=getOrigins();
      const move=(ev)=>{const rawDx=ev.clientX-sx,rawDy=ev.clientY-sy;if(altCopy&&!copied){if(Math.hypot(rawDx,rawDy)<3)return;createUndoSnapshot(`Nhân bản node`);group=duplicateNodesForDrag(group);copied=true;undoRecorded=true;origins=getOrigins();render();}
        const dx=rawDx/zoom,dy=rawDy/zoom;if(Math.abs(dx)+Math.abs(dy)<.1)return;if(!undoRecorded){createUndoSnapshot(`Di chuyển node`);undoRecorded=true;}moved=true;
        for(const origin of origins){const node=nodeById(origin.id);if(!node)continue;node.x=origin.x+dx;node.y=origin.y+dy;const nodeEl=document.querySelector(`.node[data-id="${CSS.escape(origin.id)}"]`);if(nodeEl){nodeEl.style.left=`${node.x}px`;nodeEl.style.top=`${node.y}px`;}}scheduleDrawEdges();};
      const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);if(moved){scheduleAutoSave();if(copied)setRunStatus('Đã tạo bản sao node.','ok');}};
      window.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
    };
  }

  function renderTimelineBody(node,body){
    const edges=getIncoming(node.id).filter(e=>e.targetPort.startsWith('clip'));
    const sources=new Map(edges.map(e=>[e.source,nodeById(e.source)]));
    const ordered=(node.data.clipOrder||[]).filter(id=>state.nodes.some(n=>n.id===id&&n.type==='generateVideo'));
    for(const edge of edges)if(!ordered.includes(edge.source))ordered.push(edge.source);
    for(const id of node.data.clipOrder||[])if(state.nodes.some(n=>n.id===id&&n.type==='generateVideo')&&!ordered.includes(id))ordered.push(id);
    node.data.clipOrder=ordered;syncTimelineDock();
    node._timelineEdges=edges;
    const bar=document.createElement('div');bar.className='timeline-toolbar';
    const count=document.createElement('span');count.textContent=`${ordered.length} clip`;
    const play=document.createElement('button');play.type='button';play.className='small-btn';play.textContent='▶ Xem thử cả chuỗi';play.disabled=!ordered.some(id=>nodeById(id)?.data?.asset?.url);play.onclick=()=>playTimeline(node);
    bar.append(count,play);body.appendChild(bar);
    const track=document.createElement('div');track.className='timeline-track';
    if(!ordered.length){const empty=document.createElement('div');empty.className='timeline-empty';empty.textContent='Thả node video vào đây hoặc nối vào cổng clip';track.appendChild(empty);}
    ordered.forEach((id,index)=>{
      const source=nodeById(id);if(!source)return;
      const clip=document.createElement('div');clip.className='timeline-clip';clip.draggable=true;clip.dataset.clip=id;
      clip.ondragstart=e=>{e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';};
      clip.ondragover=e=>{e.preventDefault();};
      clip.ondrop=e=>{e.preventDefault();const moving=e.dataTransfer.getData('application/x-museflow-video-node')||e.dataTransfer.getData('text/plain'),arr=[...node.data.clipOrder],from=arr.indexOf(moving),to=arr.indexOf(id);if(from>=0&&to>=0&&from!==to){createUndoSnapshot('Đổi thứ tự clip');arr.splice(from,1);arr.splice(to,0,moving);node.data.clipOrder=arr;syncTimelineDock();render();saveState();}};
      const label=document.createElement('div');label.className='timeline-clip-head';label.textContent=`${String(index+1).padStart(2,'0')} · ${source.data.asset?.name||'Clip video'}`;
      const length=document.createElement('label');length.className='clip-duration';length.textContent='Phát (giây)';
      const input=document.createElement('input');input.type='number';input.min='1';input.max='60';input.value=String(node.data.durations?.[id]||source.data.duration||5);input.onchange=()=>{node.data.durations=node.data.durations||{};node.data.durations[id]=Math.max(1,Math.min(60,Number(input.value)||5));scheduleAutoSave();};length.appendChild(input);
      const status=document.createElement('span');status.className=`timeline-clip-state ${source.data.status||'idle'}`;status.textContent=statusText(source.data.status||'waiting');
      clip.append(label,length,status);track.appendChild(clip);
    });
    body.appendChild(track);
    body.appendChild(createTimelineDropZone(node));
  }

  function createTimelineDropZone(node){
    const zone=document.createElement('div');zone.className='timeline-inline-drop';zone.textContent='Thả node video vào đây để thêm vào Timeline';
    zone.ondragover=event=>{event.preventDefault();zone.classList.add('drag-over');};zone.ondragleave=()=>zone.classList.remove('drag-over');
    zone.ondrop=event=>{event.preventDefault();zone.classList.remove('drag-over');addTimelineClip(node,event.dataTransfer.getData('application/x-museflow-video-node')||event.dataTransfer.getData('text/plain'));};return zone;
  }

  function ensureDockTimeline(){let timeline=state.nodes.find(item=>item.type==='timeline');if(!timeline){timeline={id:uid('timeline'),type:'timeline',x:0,y:0,data:{clipOrder:[],durations:{},dockOnly:true}};state.nodes.push(timeline);}timeline.data=timeline.data||{};timeline.data.clipOrder=timeline.data.clipOrder||[];timeline.data.durations=timeline.data.durations||{};return timeline;}

  function addTimelineClip(timeline,nodeId){if(!nodeId||nodeById(nodeId)?.type!=='generateVideo'){setRunStatus('Chỉ kết quả của node Tạo video mới thêm được vào Timeline.','warn');return;}timeline=timeline||state.nodes.find(item=>item.type==='timeline')||null;if(timeline?.data?.clipOrder?.includes(nodeId))return;createUndoSnapshot('Thêm video vào Timeline');timeline=timeline||ensureDockTimeline();timeline.data.clipOrder=timeline.data.clipOrder||[];if(!timeline.data.clipOrder.includes(nodeId))timeline.data.clipOrder.push(nodeId);syncTimelineDock();render();saveState();setRunStatus('Đã thêm video vào Timeline.','ok');}

  function importAllVideosToTimeline(){
    const timelineBefore=state.nodes.find(item=>item.type==='timeline'),orderBefore=timelineBefore?.data?.clipOrder||[],existing=new Set(orderBefore),all=state.nodes.filter(item=>item.type==='generateVideo');
    const additions=all.filter(video=>!existing.has(video.id));
    if(!additions.length){setRunStatus(all.length?'Mọi node Tạo video đã có trong Timeline.':'Chưa có node Tạo video nào.','warn');return;}
    createUndoSnapshot('Thêm video vào Timeline');const timeline=timelineBefore||ensureDockTimeline(),order=timeline.data.clipOrder,addIds=new Set(additions.map(video=>video.id));
    order.push(...topoOrder().filter(id=>addIds.has(id)));
    syncTimelineDock();render();saveState();if($('#timelineDock').classList.contains('collapsed'))toggleTimeline();
    setRunStatus(`Đã thêm ${additions.length} node video vào Timeline. Khi chạy, video được tạo theo thứ tự Timeline.`,'ok');
  }

  function syncTimelineDock(){
    const dock=$('#timelineDock'),track=$('#timelineTrack'),count=$('#timelineClipCount'),addButton=$('#timelineAddVideoBtn'),importAllButton=$('#timelineImportAllBtn'),outputMenu=$('#timelineOutputMenu'),node=ensureDockTimeline();dock.classList.remove('no-timeline');const allVideos=state.nodes.filter(item=>item.type==='generateVideo'),candidates=allVideos.filter(item=>!(node.data.clipOrder||[]).includes(item.id));addButton.disabled=!candidates.length;addButton.title=addButton.disabled?'Mọi video đã có trên Timeline':'Thêm một video';importAllButton.disabled=!candidates.length;importAllButton.title=!allVideos.length?'Chưa có node Tạo video nào':!candidates.length?'Mọi node Tạo video đã có trong Timeline':'Thêm mọi node Tạo video';outputMenu.innerHTML='';if(!candidates.length){const empty=document.createElement('span');empty.textContent='Chưa có video nào';outputMenu.appendChild(empty);}candidates.forEach((video,index)=>{const option=document.createElement('button');option.type='button';option.textContent=video.data.asset?.name||`Tạo video ${index+1}`;option.onclick=()=>{outputMenu.classList.add('hidden');addTimelineClip(node,video.id);};outputMenu.appendChild(option);});
    const clips=(node.data.clipOrder||[]).map(id=>nodeById(id)).filter(item=>item?.type==='generateVideo');node.data.clipOrder=clips.map(item=>item.id);count.textContent=`${clips.length} clip`;track.innerHTML='';
    const pixelsPerSecond=42,total=clips.reduce((sum,clip)=>sum+Number(node.data.durations?.[clip.id]||clip.data.duration||5),0);track.style.setProperty('--timeline-total-width',`${Math.max(track.clientWidth,total*pixelsPerSecond)}px`);const ruler=document.createElement('div');ruler.className='timeline-ruler';ruler.setAttribute('role','slider');ruler.setAttribute('aria-label','Vị trí phát Timeline');ruler.setAttribute('aria-valuemin','0');ruler.setAttribute('aria-valuemax',String(total));ruler.tabIndex=0;ruler.style.width=`${Math.max(track.clientWidth,total*pixelsPerSecond)}px`;for(let sec=0;sec<=Math.ceil(total);sec+=5){const tick=document.createElement('span');tick.textContent=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;tick.style.flexBasis=`${5*pixelsPerSecond}px`;ruler.appendChild(tick);}track.appendChild(ruler);
    const playhead=document.createElement('div');playhead.className='timeline-playhead';playhead.style.left=`${(state.timelinePreviewPosition||0)*pixelsPerSecond}px`;playhead.style.height=`${Math.max(70,track.clientHeight-8)}px`;playhead.setAttribute('aria-hidden','true');track.appendChild(playhead);
    let scrubbing=false;const updateScrub=e=>{const rect=track.getBoundingClientRect(),time=Math.max(0,Math.min(total,(e.clientX-rect.left+track.scrollLeft)/pixelsPerSecond));state.timelinePreviewPosition=time;ruler.setAttribute('aria-valuenow',String(time.toFixed(2)));playhead.style.left=`${time*pixelsPerSecond}px`;};ruler.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();scrubbing=true;ruler.setPointerCapture(e.pointerId);updateScrub(e);};ruler.onpointermove=e=>{if(scrubbing)updateScrub(e);};ruler.onpointerup=e=>{if(!scrubbing)return;scrubbing=false;updateScrub(e);playTimeline(node,{startTime:state.timelinePreviewPosition});};ruler.onpointercancel=()=>{scrubbing=false;};ruler.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?total:Math.max(0,Math.min(total,(state.timelinePreviewPosition||0)+(e.key==='ArrowRight'?1:-1)));state.timelinePreviewPosition=next;playhead.style.left=`${next*pixelsPerSecond}px`;ruler.setAttribute('aria-valuenow',String(next));playTimeline(node,{startTime:next});};
    const lane=document.createElement('div');lane.className='timeline-lane';if(!clips.length){const empty=document.createElement('div');empty.className='dock-empty';empty.textContent='Thả node Tạo video vào đây để xếp chuỗi cảnh';lane.appendChild(empty);}
    clips.forEach((clip,index)=>{const duration=Number(node.data.durations?.[clip.id]||clip.data.duration||5),item=document.createElement('div');item.className=`dock-clip${duration<4?' compact':''}`;item.style.width=`${duration*pixelsPerSecond}px`;item.style.minWidth=`${duration*pixelsPerSecond}px`;item.style.maxWidth=`${duration*pixelsPerSecond}px`;item.draggable=true;item.dataset.clip=clip.id;item.ondragstart=event=>{event.dataTransfer.setData('application/x-museflow-video-node',clip.id);event.dataTransfer.effectAllowed='move';};item.ondragover=event=>event.preventDefault();item.ondrop=event=>{event.preventDefault();const moving=event.dataTransfer.getData('application/x-museflow-video-node'),from=node.data.clipOrder.indexOf(moving),to=node.data.clipOrder.indexOf(clip.id);if(from>=0&&to>=0&&from!==to){createUndoSnapshot('Đổi thứ tự clip');node.data.clipOrder.splice(from,1);node.data.clipOrder.splice(to,0,moving);syncTimelineDock();render();saveState();}else if(moving&&nodeById(moving)?.type==='generateVideo')addTimelineClip(node,moving);};
      const thumb=document.createElement('div');thumb.className='dock-clip-thumb';if(clip.data.asset?.url){if(clip.data.asset.kind==='image'){const image=document.createElement('img');image.src=clip.data.asset.url;thumb.appendChild(image);}else{const video=document.createElement('video');video.src=clip.data.asset.url;video.muted=true;video.preload='metadata';thumb.appendChild(video);}}else thumb.textContent='▶';
      const details=document.createElement('div');details.className='dock-clip-details';const title=document.createElement('span');title.textContent=`${String(index+1).padStart(2,'0')} · ${clip.data.asset?.name||'Video '+(index+1)}`;title.title=title.textContent;const length=document.createElement('label');length.textContent='Độ dài';const input=document.createElement('input');input.type='number';input.min='1';input.max='60';input.value=String(duration);input.onchange=()=>{node.data.durations=node.data.durations||{};node.data.durations[clip.id]=Math.max(1,Math.min(60,Number(input.value)||5));syncTimelineDock();render();saveState();};length.appendChild(input);details.append(title,length);const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Bỏ clip';remove.onclick=()=>{createUndoSnapshot('Bỏ clip khỏi Timeline');node.data.clipOrder=node.data.clipOrder.filter(id=>id!==clip.id);syncTimelineDock();render();saveState();};item.append(thumb,details,remove);lane.appendChild(item);});track.appendChild(lane);
    dock.ondragover=event=>{if(event.dataTransfer.types.includes('application/x-museflow-video-node')){event.preventDefault();dock.classList.add('drag-over');if(dock.classList.contains('collapsed'))toggleTimeline();}};dock.ondragleave=event=>{if(!dock.contains(event.relatedTarget))dock.classList.remove('drag-over');};dock.ondrop=event=>{event.preventDefault();dock.classList.remove('drag-over');const id=event.dataTransfer.getData('application/x-museflow-video-node');if(id)addTimelineClip(node,id);};
  }

  function toggleTimelineOutputMenu(){if($('#timelineAddVideoBtn').disabled)return;$('#timelineOutputMenu').classList.toggle('hidden');}

  function toggleTimeline(){const dock=$('#timelineDock'),collapsed=dock.classList.toggle('collapsed'),button=$('#timelineToggleBtn');button.textContent=collapsed?'▲':'▼';button.title=collapsed?'Hiện Timeline':'Ẩn Timeline';button.setAttribute('aria-expanded',String(!collapsed));}

  function closeTimelinePreview(){state.timelinePreviewToken++;clearTimeout(state.timelinePreviewTimer);cancelAnimationFrame(state.timelinePlayheadFrame);state.timelinePlayheadFrame=0;for(const player of [$('#timelinePlayer'),$('#timelinePlayerNext')]){player.pause();player.onended=null;}$('#timelinePreviewPanel').classList.add('hidden');}
  function visibleTimelineClipOrder(node){const nodeTrack=document.querySelector(`.node[data-id="${CSS.escape(node.id)}"] .timeline-track`),dockTrack=$('#timelineTrack'),visualTrack=nodeTrack||dockTrack,selector=nodeTrack?'.timeline-clip':'.dock-clip',visibleOrder=[...visualTrack.querySelectorAll(selector)].map(item=>item.dataset.clip).filter(Boolean);return visibleOrder.length?visibleOrder:[...(node.data.clipOrder||[])];}
  function playTimeline(node,{startTime=0}={}){
    const players=[$('#timelinePlayer'),$('#timelinePlayerNext')],panel=$('#timelinePreviewPanel'),clips=visibleTimelineClipOrder(node).map(id=>nodeById(id)).filter(n=>n?.type==='generateVideo'&&n.data?.asset?.url);
    if(!clips.length){setRunStatus('Hãy nối các clip đã tạo xong vào Timeline trước.','warn');return;}
    clearTimeout(state.timelinePreviewTimer);cancelAnimationFrame(state.timelinePlayheadFrame);const token=++state.timelinePreviewToken;panel.classList.remove('hidden');const durationOf=clip=>Math.max(1,Number(node.data.durations?.[clip.id]||clip.data.duration||5)),total=clips.reduce((sum,clip)=>sum+durationOf(clip),0);let position=Math.max(0,Math.min(total,Number(startTime)||0)),index=0;while(index<clips.length-1&&position>=durationOf(clips[index])){position-=durationOf(clips[index]);index++;}let firstOffset=position,activeClipStart=Math.max(0,startTime-position),tickerStarted=false,active=players.findIndex(player=>player.classList.contains('is-active'));if(active<0)active=0;state.timelinePreviewPosition=startTime;
    players.forEach(player=>{player.pause();player.onended=null;player.muted=false;player.controls=player===players[active];});
    const waitForFrame=video=>new Promise(resolve=>{let finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(fallback);resolve();};const fallback=setTimeout(done,1200);if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(done);else requestAnimationFrame(()=>requestAnimationFrame(done));});
    const waitForData=video=>new Promise((resolve,reject)=>{if(video.readyState>=2){resolve();return;}let timer=setTimeout(()=>{cleanup();reject(new Error('Clip tiếp theo tải quá lâu.'));},15000);const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Không tải được clip tiếp theo.'));},cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);};video.addEventListener('loadeddata',ready,{once:true});video.addEventListener('error',failed,{once:true});});
    const prepareClip=(clipIndex,video)=>{const clip=clips[clipIndex];if(!clip)return Promise.resolve();if(video.dataset.preloadClip===clip.id&&video.readyState>=2)return Promise.resolve(video);video.pause();video.onended=null;video.preload='auto';video.dataset.preloadClip=clip.id;video.src=clip.data.asset.url;video.load();return waitForData(video).then(()=>{if(video.dataset.preloadClip===clip.id)video.currentTime=0;return video;});};
    const playNext=async()=>{
      clearTimeout(state.timelinePreviewTimer);if(token!==state.timelinePreviewToken)return;
      if(index>=clips.length){players[active].onended=null;players[active].pause();state.timelinePreviewPosition=total;const head=$('#timelineTrack .timeline-playhead');if(head)head.style.left=`${total*42}px`;cancelAnimationFrame(state.timelinePlayheadFrame);setRunStatus('Đã xem thử xong Timeline.','ok');return;}
      const clipIndex=index,clip=clips[index++],nextIndex=1-active,next=players[nextIndex],previous=players[active];next.pause();next.onended=null;next.muted=false;next.controls=false;next.classList.remove('is-active','is-fading');
      const clipOffset=firstOffset;firstOffset=0;let clipStart=0;for(let i=0;i<clipIndex;i++)clipStart+=durationOf(clips[i]);activeClipStart=clipStart;
      try{await prepareClip(clipIndex,next);if(token!==state.timelinePreviewToken)return;next.currentTime=Math.min(clipOffset,Math.max(0,(next.duration||durationOf(clip))-0.05));activeClipStart=clipStart;await next.play();await waitForFrame(next);}catch(error){if(token===state.timelinePreviewToken&&next.readyState>=2){next.controls=true;next.classList.add('is-active');previous.controls=false;previous.classList.remove('is-active','is-fading');active=nextIndex;next.onended=()=>{if(token===state.timelinePreviewToken)playNext();};setRunStatus(`Clip đã sẵn sàng; bấm Phát để xem tiếp (${error.message})`,'warn');}else if(token===state.timelinePreviewToken)setRunStatus(`Tạm dừng xem thử: ${error.message}`,'error');return;}
      if(token!==state.timelinePreviewToken){next.pause();return;}
      next.controls=true;next.classList.add('is-active');previous.controls=false;previous.onended=null;previous.classList.remove('is-active');previous.classList.add('is-fading');active=nextIndex;setTimeout(()=>{previous.classList.remove('is-fading');if(token===state.timelinePreviewToken)previous.pause();},180);
      if(!tickerStarted){tickerStarted=true;const tick=()=>{if(token!==state.timelinePreviewToken)return;const current=players[active],time=activeClipStart+(Number(current.currentTime)||0);state.timelinePreviewPosition=time;const head=$('#timelineTrack .timeline-playhead');if(head)head.style.left=`${time*42}px`;state.timelinePlayheadFrame=requestAnimationFrame(tick);};state.timelinePlayheadFrame=requestAnimationFrame(tick);}
      if(index<clips.length)prepareClip(index,previous).catch(()=>{});
      const advance=()=>{if(token!==state.timelinePreviewToken)return;clearTimeout(state.timelinePreviewTimer);next.onended=null;playNext();};next.onended=advance;
      state.timelinePreviewTimer=setTimeout(advance,Math.max(0.1,durationOf(clip)-clipOffset)*1000);setRunStatus(`Cảnh ${index}/${clips.length}`,'warn');
    };
    playNext();
  }

  function createSilentWav(){const sampleRate=48000,channels=2,bitsPerSample=16,dataBytes=sampleRate*channels*(bitsPerSample/8),buffer=new ArrayBuffer(44+dataBytes),view=new DataView(buffer),bytes=new Uint8Array(buffer);const write=(offset,value)=>{for(let index=0;index<value.length;index++)bytes[offset+index]=value.charCodeAt(index);};write(0,'RIFF');view.setUint32(4,36+dataBytes,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*channels*(bitsPerSample/8),true);view.setUint16(32,channels*(bitsPerSample/8),true);view.setUint16(34,bitsPerSample,true);write(36,'data');view.setUint32(40,dataBytes,true);return bytes;}

  async function exportTimelineMp4WithFFmpeg(node,clips,button,formatSelect){
    const stopButton=$('#timelineExportStopBtn'),abortController=new AbortController(),signal=abortController.signal,sourceUrls=[],ffmpeg=new window.FFmpegWASM.FFmpeg(),logs=[];let completed=false;
    state.timelineExporting=true;state.timelineExportAbortController=abortController;state.timelineFFmpeg=ffmpeg;button.disabled=true;formatSelect.disabled=true;stopButton.classList.remove('hidden');
    const throwIfStopped=()=>{if(signal.aborted)throw new DOMException('Đã dừng xuất video.','AbortError');};
    const onLog=event=>{if(event?.message){logs.push(event.message);if(logs.length>30)logs.shift();}},onProgress=event=>{if(!signal.aborted&&Number.isFinite(event?.progress)){button.textContent=`Encoding ${Math.max(0,Math.min(99,Math.round(event.progress*100)))}%…`;setRunStatus(`Đang mã hoá MP4 bằng FFmpeg · ${Math.max(0,Math.min(99,Math.round(event.progress*100)))}%`,'warn');}};
    try{
      ffmpeg.on('log',onLog);ffmpeg.on('progress',onProgress);
      button.textContent='Đang tải FFmpeg…';setRunStatus('Đang tải bộ xử lý video FFmpeg…','warn');
      // The bundled UMD wrapper uses importScripts() to load the core, so let
      // it create a classic worker instead of forcing the module class worker.
      await ffmpeg.load({coreURL:chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.js'),wasmURL:chrome.runtime.getURL('vendor/ffmpeg/ffmpeg-core.wasm')},{signal});
      const clipInfo=[];
      for(let index=0;index<clips.length;index++){
        throwIfStopped();button.textContent=`Đang tải clip ${index+1}/${clips.length}…`;setRunStatus(`Đang nạp clip ${index+1}/${clips.length} vào FFmpeg…`,'warn');
        const response=await fetch(clips[index].data.asset.url,{credentials:'include',signal});if(!response.ok)throw new Error(`Không tải được clip ${index+1} (HTTP ${response.status}).`);
        const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length)throw new Error(`Clip ${index+1} bị rỗng.`);const inputPath=`/scene_${String(index).padStart(3,'0')}.bin`;await ffmpeg.writeFile(inputPath,bytes,{signal});sourceUrls.push(inputPath);
        const probePath=`/probe_${index}.json`;await ffmpeg.ffprobe(['-v','error','-show_entries','stream=codec_type,codec_name,width,height,profile,pix_fmt,sample_rate,channels:format=duration','-of','json',inputPath,'-o',probePath],-1,{signal});const raw=await ffmpeg.readFile(probePath,'utf8',{signal}),probe=JSON.parse(typeof raw==='string'?raw:new TextDecoder().decode(raw));const videoStream=probe.streams?.find(stream=>stream.codec_type==='video'),audioStream=probe.streams?.find(stream=>stream.codec_type==='audio');if(!videoStream)throw new Error(`Clip ${index+1} không đọc được hình.`);clipInfo.push({hasAudio:!!audioStream,width:Number(videoStream.width)||1280,height:Number(videoStream.height)||720,videoCodec:videoStream.codec_name,videoProfile:videoStream.profile,pixelFormat:videoStream.pix_fmt,audioCodec:audioStream?.codec_name,audioRate:Number(audioStream?.sample_rate)||0,audioChannels:Number(audioStream?.channels)||0,sourceDuration:Number(probe.format?.duration)||0,duration:Math.max(1,Math.min(60,Number(node.data.durations?.[clips[index].id]||clips[index].data.duration||5)))});await ffmpeg.deleteFile(probePath,{signal});
      }
      throwIfStopped();
      const firstInfo=clipInfo[0],copyCompatible=clipInfo.every(item=>item.videoCodec==='h264'&&item.videoProfile===firstInfo.videoProfile&&item.pixelFormat===firstInfo.pixelFormat&&item.width===firstInfo.width&&item.height===firstInfo.height&&item.hasAudio&&item.audioCodec==='aac'&&item.audioRate===firstInfo.audioRate&&item.audioChannels===firstInfo.audioChannels&&item.sourceDuration>0&&Math.abs(item.sourceDuration-item.duration)<0.15);
      if(copyCompatible){const concatFile='/timeline-inputs.txt',concatData=new TextEncoder().encode(sourceUrls.map(path=>`file '${path}'`).join('\n')+'\n');await ffmpeg.writeFile(concatFile,concatData,{signal});button.textContent='Đang ghép các clip MP4…';setRunStatus('Đang ghép các clip không cần mã hoá lại (nhanh, giữ chất lượng gốc)…','warn');const exitCode=await ffmpeg.exec(['-f','concat','-safe','0','-i',concatFile,'-c','copy','-movflags','+faststart','-y','/museflow-timeline.mp4'],-1,{signal});if(exitCode!==0)throw new Error(logs.slice(-5).map(item=>item.trim()).filter(Boolean).join(' ')||`FFmpeg dừng với mã lỗi ${exitCode}.`);}
      else{
      const silentInput='/timeline-silence.wav',needsSilence=clipInfo.some(item=>!item.hasAudio);if(needsSilence)await ffmpeg.writeFile(silentInput,createSilentWav(),{signal});
      const silentIndexes=new Map();let inputIndex=clips.length;for(let index=0;index<clipInfo.length;index++)if(!clipInfo[index].hasAudio)silentIndexes.set(index,inputIndex++);
      const first=clipInfo[0],scale=Math.min(1,1280/Math.max(first.width,first.height)),width=Math.max(2,Math.floor(first.width*scale/2)*2),height=Math.max(2,Math.floor(first.height*scale/2)*2),filterParts=[],concatInputs=[];
      clipInfo.forEach((item,index)=>{const duration=item.duration.toFixed(3),videoLabel=`v${index}`,audioLabel=`a${index}`;filterParts.push(`[${index}:v:0]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=24,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS[${videoLabel}]`);const audioSource=item.hasAudio?`${index}:a:0`:`${silentIndexes.get(index)}:a:0`;filterParts.push(`[${audioSource}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad=pad_dur=${duration},atrim=duration=${duration}[${audioLabel}]`);concatInputs.push(`[${videoLabel}][${audioLabel}]`);});
      filterParts.push(`${concatInputs.join('')}concat=n=${clipInfo.length}:v=1:a=1[outv][outa]`);
      const args=[];sourceUrls.forEach(path=>args.push('-i',path));for(const [index] of silentIndexes)args.push('-stream_loop','-1','-i',silentInput);
      args.push('-filter_complex',filterParts.join(';'),'-map','[outv]','-map','[outa]','-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-max_muxing_queue_size','1024','-y','/museflow-timeline.mp4');
      button.textContent='Đang mã hoá MP4…';setRunStatus('FFmpeg đang ghép và mã hoá toàn bộ Timeline ngay trên máy…','warn');const exitCode=await ffmpeg.exec(args,-1,{signal});if(exitCode!==0)throw new Error(logs.slice(-5).map(item=>item.trim()).filter(Boolean).join(' ')||`FFmpeg dừng với mã lỗi ${exitCode}.`);
      }
      throwIfStopped();const output=await ffmpeg.readFile('/museflow-timeline.mp4','binary',{signal});if(!(output instanceof Uint8Array)||!output.length)throw new Error('FFmpeg tạo ra file MP4 rỗng.');
      if(state.timelineExportUrl)URL.revokeObjectURL(state.timelineExportUrl);state.timelineExportUrl=URL.createObjectURL(new Blob([output],{type:'video/mp4'}));const player=$('#timelinePlayer'),nextPlayer=$('#timelinePlayerNext');closeTimelinePreview();$('#timelinePreviewPanel').classList.remove('hidden');nextPlayer.pause();nextPlayer.classList.remove('is-active','is-fading');nextPlayer.controls=false;player.src=state.timelineExportUrl;player.controls=true;player.classList.remove('is-fading');player.classList.add('is-active');const link=document.createElement('a');link.href=state.timelineExportUrl;link.download=`TheKey-Timeline-${new Date().toISOString().replace(/[:.]/g,'-')}.mp4`;link.click();completed=true;setRunStatus('Đã xuất Timeline thành MP4 (H.264).','ok');
    }catch(error){if(error?.name==='AbortError'||signal.aborted)setRunStatus('Đã dừng xuất video.','warn');else setRunStatus(`Xuất video thất bại: ${error?.message||String(error)}`,'error');}
    finally{ffmpeg.off('log',onLog);ffmpeg.off('progress',onProgress);ffmpeg.terminate();state.timelineFFmpeg=null;state.timelineExportAbortController=null;state.timelineExporting=false;button.disabled=false;formatSelect.disabled=false;button.textContent='⇩ Xuất';stopButton.classList.add('hidden');}
  }

  async function exportTimelineVideo(){
    if(state.timelineExporting)return;const node=ensureDockTimeline(),clips=visibleTimelineClipOrder(node).map(id=>nodeById(id)).filter(clip=>clip?.type==='generateVideo'&&clip.data?.asset?.url),button=$('#timelineExportBtn'),formatSelect=$('#timelineExportFormat'),requestedFormat=formatSelect.value;
    if(!clips.length){setRunStatus('Hãy thêm các clip đã tạo xong vào Timeline trước khi xuất.','warn');return;}
    if(requestedFormat==='mp4'){if(!window.FFmpegWASM?.FFmpeg){setRunStatus('Không tải được FFmpeg. Hãy Reload extension rồi thử lại.','error');return;}return exportTimelineMp4WithFFmpeg(node,clips,button,formatSelect);}
    if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){setRunStatus('Trình duyệt này không xuất được video ghép từ Timeline.','error');return;}
    state.timelineExporting=true;state.timelineExportAbortController=new AbortController();const exportSignal=state.timelineExportAbortController.signal,stopButton=$('#timelineExportStopBtn');button.disabled=true;formatSelect.disabled=true;stopButton.classList.remove('hidden');const sourceUrls=[];let recorder=null,canvasStream=null,audioContext=null,audioSource=null,audioDestination=null,audioResumePromise=Promise.resolve(),video=null,frameRequest=0,frameTimer=0,recordingPromise=null,recorderMimeType='';
    const throwIfStopped=()=>{if(exportSignal.aborted)throw new DOMException('Đã dừng xuất video.','AbortError');};
    const waitForExportDelay=duration=>new Promise((resolve,reject)=>{throwIfStopped();const timer=setTimeout(()=>{exportSignal.removeEventListener('abort',cancel);resolve();},duration),cancel=()=>{clearTimeout(timer);reject(new DOMException('Đã dừng xuất video.','AbortError'));};exportSignal.addEventListener('abort',cancel,{once:true});});
    try{const AudioContextType=window.AudioContext||window.webkitAudioContext;if(AudioContextType){audioContext=new AudioContextType();audioDestination=audioContext.createMediaStreamDestination();audioResumePromise=audioContext.resume().catch(()=>{});}}catch{audioContext=null;audioDestination=null;}
    try{
      for(let index=0;index<clips.length;index++){
        throwIfStopped();button.textContent=`Đang chuẩn bị ${index+1}/${clips.length}…`;setRunStatus(`Đang chuẩn bị clip ${index+1}/${clips.length} để xuất…`,'warn');
        const response=await fetch(clips[index].data.asset.url,{credentials:'include',signal:exportSignal});if(!response.ok)throw new Error(`Không tải được clip ${index+1} (HTTP ${response.status}).`);
        const blob=await response.blob();if(!blob.size)throw new Error(`Clip ${index+1} bị rỗng.`);sourceUrls.push(URL.createObjectURL(blob));
      }
      video=document.createElement('video');video.preload='auto';video.playsInline=true;video.muted=false;video.style.cssText='position:fixed;width:2px;height:2px;left:-4px;bottom:0;opacity:.01;pointer-events:none';document.body.appendChild(video);
      const waitForData=()=>new Promise((resolve,reject)=>{if(exportSignal.aborted){reject(new DOMException('Đã dừng xuất video.','AbortError'));return;}if(video.readyState>=2){resolve();return;}let timer=setTimeout(()=>{cleanup();reject(new Error('Giải mã video quá lâu.'));},20000);const ready=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Không giải mã được file video.'));},cancel=()=>{cleanup();reject(new DOMException('Đã dừng xuất video.','AbortError'));},cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);exportSignal.removeEventListener('abort',cancel);};video.addEventListener('loadeddata',ready,{once:true});video.addEventListener('error',failed,{once:true});exportSignal.addEventListener('abort',cancel,{once:true});});
      video.src=sourceUrls[0];video.load();await waitForData();
      const originalWidth=video.videoWidth||1280,originalHeight=video.videoHeight||720,scale=Math.min(1,1280/Math.max(originalWidth,originalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.floor(originalWidth*scale/2)*2);canvas.height=Math.max(2,Math.floor(originalHeight*scale/2)*2);
      const context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('Không tạo được khung xuất video.');
      const exportFps=20;const drawFrame=()=>{if(!video||!context)return;if(video.readyState>=2&&video.videoWidth>0){const fit=Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight),width=video.videoWidth*fit,height=video.videoHeight*fit;context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(video,(canvas.width-width)/2,(canvas.height-height)/2,width,height);}frameTimer=setTimeout(drawFrame,1000/exportFps);};drawFrame();
      canvasStream=canvas.captureStream(exportFps);
      if(audioContext&&audioDestination){try{audioSource=audioContext.createMediaElementSource(video);audioSource.connect(audioDestination);const audioTrack=audioDestination.stream.getAudioTracks()[0];if(audioTrack)canvasStream.addTrack(audioTrack);await audioResumePromise;if(audioContext.state!=='running')await audioContext.resume();}catch{audioContext.close().catch(()=>{});audioContext=null;audioDestination=null;audioSource=null;}}
      if(!audioDestination&&typeof video.captureStream==='function'){const captured=video.captureStream();for(const track of captured.getAudioTracks())canvasStream.addTrack(track);}
      const mimeTypes=requestedFormat==='mp4'?['video/mp4;codecs="avc1.42E01E,mp4a.40.2"','video/mp4;codecs="avc1.424028,mp4a.40.2"','video/mp4;codecs=avc1,mp4a.40.2','video/mp4;codecs=avc1','video/mp4']:['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
      recorderMimeType=mimeTypes.find(type=>MediaRecorder.isTypeSupported?.(type))||'';
      if(requestedFormat==='mp4'&&!recorderMimeType)throw new Error('Trình duyệt này không mã hoá được MP4 (H.264). Hãy chọn WebM.');
      const recorderOptions={videoBitsPerSecond:requestedFormat==='mp4'?Math.round(Math.min(9_000_000,Math.max(6_000_000,canvas.width*canvas.height*exportFps*0.28))):undefined,audioBitsPerSecond:192_000};if(recorderMimeType)recorderOptions.mimeType=recorderMimeType;
      recorder=new MediaRecorder(canvasStream,recorderOptions);
      const chunks=[];recordingPromise=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data?.size)chunks.push(event.data);};recorder.onerror=event=>reject(event.error||new Error('Mã hoá video thất bại.'));recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType||recorderMimeType||'video/webm'}));});recordingPromise.catch(()=>{});recorder.start(1000);
      for(let index=0;index<clips.length;index++){
        throwIfStopped();
        if(index){if(recorder.state==='recording')recorder.pause();video.pause();video.src=sourceUrls[index];video.load();await waitForData();}
        video.currentTime=0;await video.play();if(index){await waitForExportDelay(60);if(recorder.state==='paused')recorder.resume();}button.textContent=`Đang xuất ${index+1}/${clips.length}…`;setRunStatus(`Đang xuất clip ${index+1}/${clips.length} theo thứ tự…`,'warn');
        const duration=Math.max(1,Math.min(60,Number(node.data.durations?.[clips[index].id]||clips[index].data.duration||5)));await waitForExportDelay(duration*1000);video.pause();
      }
      const completed=new Promise(resolve=>{recorder.addEventListener('stop',resolve,{once:true});});recorder.stop();await completed;const output=await recordingPromise;if(!output.size)throw new Error('Video xuất ra bị rỗng.');
      const actualMime=(output.type||recorder.mimeType||recorderMimeType||'video/webm').toLowerCase(),extension=actualMime.includes('mp4')?'mp4':'webm';if(requestedFormat==='mp4'&&extension!=='mp4')throw new Error('Trình duyệt không tạo được file MP4. Hãy chọn WebM.');
      if(state.timelineExportUrl)URL.revokeObjectURL(state.timelineExportUrl);state.timelineExportUrl=URL.createObjectURL(output);
      const player=$('#timelinePlayer'),nextPlayer=$('#timelinePlayerNext');closeTimelinePreview();$('#timelinePreviewPanel').classList.remove('hidden');nextPlayer.pause();nextPlayer.classList.remove('is-active','is-fading');nextPlayer.controls=false;player.src=state.timelineExportUrl;player.controls=true;player.classList.remove('is-fading');player.classList.add('is-active');
      const link=document.createElement('a');link.href=state.timelineExportUrl;link.download=`TheKey-Timeline-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;link.click();setRunStatus(`Đã xuất video ghép dạng ${extension.toUpperCase()}.`,'ok');
    }catch(error){if(error?.name==='AbortError')setRunStatus('Đã dừng xuất video.','warn');else setRunStatus(`Xuất video thất bại: ${error?.message||String(error)}`,'error');}
    finally{if(frameRequest)cancelAnimationFrame(frameRequest);clearTimeout(frameTimer);if(recorder?.state==='recording'||recorder?.state==='paused'){recorder.stop();try{await recordingPromise;}catch{}}video?.pause();video?.remove();canvasStream?.getTracks().forEach(track=>track.stop());await audioContext?.close().catch(()=>{});sourceUrls.forEach(url=>URL.revokeObjectURL(url));state.timelineExporting=false;state.timelineExportAbortController=null;button.disabled=false;formatSelect.disabled=false;button.textContent='⇩ Xuất';stopButton.classList.add('hidden');}
  }

  function stopTimelineExport(){if(!state.timelineExporting)return;state.timelineExportAbortController?.abort();state.timelineFFmpeg?.terminate();setRunStatus('Đang dừng xuất…','warn');}

  function getPortCenter(nodeId, portId, kind) {
    const q = `.port.${kind}[data-node="${CSS.escape(nodeId)}"][data-port="${CSS.escape(portId)}"]`;
    const p = document.querySelector(q); if (!p) return null;
    const r=p.getBoundingClientRect(), vr=$('#viewport').getBoundingClientRect();
    return { x:(r.left-vr.left-state.panX)/state.zoom+r.width/(2*state.zoom), y:(r.top-vr.top-state.panY)/state.zoom+r.height/(2*state.zoom) };
  }

  function drawEdges() {
    edgesSvg.innerHTML='';
    state.edges.forEach(e => {
      const a=getPortCenter(e.source,e.sourcePort,'out'), b=getPortCenter(e.target,e.targetPort,'in'); if(!a||!b)return;
      const incoming=getIncoming(e.target,e.targetPort),index=incoming.findIndex(edge=>edge.id===e.id),fan=isMultiInput(nodeById(e.target)?.type,e.targetPort)&&incoming.length>1?(index-(incoming.length-1)/2)*12:0;
      const dx=b.x-a.x,direction=dx<0?-1:1,bend=Math.max(62,Math.abs(dx)*.42),output=nodeDefs[nodeById(e.source)?.type]?.outputs?.find(port=>port.id===e.sourcePort),d=`M ${a.x} ${a.y} C ${a.x+direction*bend} ${a.y}, ${b.x-direction*bend} ${b.y+fan}, ${b.x} ${b.y}`,selected=state.selectedEdgeIds.includes(e.id);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('class',`edge edge-${output?.type||'media'}${selected?' edge-selected':''}`);path.setAttribute('d',d);path.setAttribute('data-edge-id',e.id);edgesSvg.appendChild(path);const hit=document.createElementNS('http://www.w3.org/2000/svg','path');hit.setAttribute('class','edge-hit');hit.setAttribute('data-edge-id',e.id);hit.setAttribute('d',d);edgesSvg.appendChild(hit);
    });
    if(state.draggingWire&&state.wirePointer){
      const reverse=state.draggingWire.direction==='in',a=getPortCenter(state.draggingWire.nodeId,state.draggingWire.portId,reverse?'in':'out');
      const vr=$('#viewport').getBoundingClientRect();
      if(a){const x=(state.wirePointer.x-vr.left-state.panX)/state.zoom,y=(state.wirePointer.y-vr.top-state.panY)/state.zoom,dx=reverse?a.x-x:x-a.x,direction=dx<0?-1:1,bend=Math.max(55,Math.abs(dx)*.4),d=reverse?`M ${x} ${y} C ${x+direction*bend} ${y}, ${a.x-direction*bend} ${a.y}, ${a.x} ${a.y}`:`M ${a.x} ${a.y} C ${a.x+direction*bend} ${a.y}, ${x-direction*bend} ${y}, ${x} ${y}`;const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('class','edge edge-draft');p.setAttribute('d',d);edgesSvg.appendChild(p);}
    }
  }

  function scheduleDrawEdges() {
    if (state.edgeFrame) return;
    state.edgeFrame = requestAnimationFrame(() => { state.edgeFrame = 0; drawEdges(); });
  }

  function render() {
    syncPreviewOutputs();canvas.innerHTML='';state.groups.forEach(group=>canvas.appendChild(renderCanvasGroup(group)));state.notes.forEach(note=>canvas.appendChild(renderCanvasNote(note)));state.nodes.filter(n=>!n.data?.dockOnly).forEach(n => canvas.appendChild(renderNode(n)));applyCanvasTransform();requestAnimationFrame(drawEdges);syncTimelineDock();scheduleAutoSave();
  }

  function renderCanvasNote(note){
    const el=document.createElement('article');el.className='canvas-note';el.dataset.noteId=note.id;el.style.left=`${note.x}px`;el.style.top=`${note.y}px`;el.style.width=`${note.width||260}px`;el.style.height=`${note.height||160}px`;
    const header=document.createElement('header');header.className='canvas-note-header';const title=document.createElement('span');title.textContent='Ghi chú';const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='Xoá ghi chú';remove.onclick=event=>{event.stopPropagation();createUndoSnapshot('Xoá ghi chú');state.notes=state.notes.filter(item=>item.id!==note.id);render();saveState();};header.append(title,remove);
    header.onpointerdown=event=>{if(event.button!==0||event.target.closest('button'))return;event.preventDefault();event.stopPropagation();state.noteDrag={id:note.id,startX:event.clientX,startY:event.clientY,x:note.x,y:note.y,moved:false};try{header.setPointerCapture(event.pointerId);}catch{}};
    const textarea=document.createElement('textarea');textarea.value=note.text||'';textarea.placeholder='Viết ghi chú…';textarea.onbeforeinput=event=>trackUndoEdit(event);textarea.oninput=()=>{note.text=textarea.value;scheduleAutoSave();};
    el.append(header,textarea);return el;
  }
  function moveTextNote(event){const drag=state.noteDrag;if(!drag)return;const note=state.notes.find(item=>item.id===drag.id),el=document.querySelector(`.canvas-note[data-note-id="${CSS.escape(drag.id)}"]`);if(!note||!el)return;const dx=(event.clientX-drag.startX)/state.zoom,dy=(event.clientY-drag.startY)/state.zoom;if(Math.abs(dx)+Math.abs(dy)<2)return;if(!drag.moved)createUndoSnapshot('Di chuyển ghi chú');drag.moved=true;note.x=drag.x+dx;note.y=drag.y+dy;el.style.left=`${note.x}px`;el.style.top=`${note.y}px`;}
  function finishTextNoteMove(){if(!state.noteDrag)return;const moved=state.noteDrag.moved;state.noteDrag=null;if(moved){render();saveState();}}

  function renderCanvasGroup(group){
    const frame=document.createElement('div');frame.className='canvas-group';frame.style.left=`${group.x}px`;frame.style.top=`${group.y}px`;frame.style.width=`${group.width}px`;frame.style.height=`${group.height}px`;
    const label=document.createElement('span');label.className='canvas-group-label';label.textContent=group.name||'Group';
    const remove=document.createElement('button');remove.type='button';remove.className='canvas-group-delete';remove.textContent='×';remove.title='Xoá vùng nhóm';remove.setAttribute('aria-label','Xoá vùng nhóm');remove.onclick=event=>{event.stopPropagation();createUndoSnapshot('Xoá vùng nhóm');state.groups=state.groups.filter(item=>item.id!==group.id);render();saveState();};
    frame.append(label,remove);return frame;
  }

  function syncPreviewOutputs(){for(const preview of state.nodes.filter(node=>node.type==='preview')){const edge=getIncoming(preview.id,'media')[0],source=edge&&nodeById(edge.source);let asset=null;if(source){asset=edge.sourcePort==='endFrame'?source.data?.endFrame:source.data?.asset;if(!asset&&source.type==='imageInput'&&source.data?.localDataUrl)asset={id:source.id,kind:'image',url:source.data.localDataUrl,name:'Ảnh đầu vào'};}preview.data.asset=asset||null;}}

  function applyCanvasTransform(){const transform=`translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;canvas.style.transform=transform;edgesSvg.style.transform=transform;$('#zoomLevel').textContent=`${Math.round(state.zoom*100)}%`;$('#viewport').classList.toggle('hand-mode',state.handMode||state.spaceDown);}
  function zoomAt(clientX,clientY,factor){const rect=$('#viewport').getBoundingClientRect(),x=clientX-rect.left,y=clientY-rect.top,old=state.zoom,next=Math.max(.25,Math.min(2.5,old*factor));if(next===old)return;const contentX=(x-state.panX)/old,contentY=(y-state.panY)/old;state.zoom=next;state.panX=x-contentX*next;state.panY=y-contentY*next;applyCanvasTransform();scheduleDrawEdges();}
  function setZoom(value){const rect=$('#viewport').getBoundingClientRect();zoomAt(rect.left+rect.width/2,rect.top+rect.height/2,value/state.zoom);}
  function fitCanvas(){const nodes=state.nodes.filter(node=>!node.data?.dockOnly);if(!nodes.length){state.zoom=1;state.panX=0;state.panY=0;applyCanvasTransform();return;}const rect=$('#viewport').getBoundingClientRect(),xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),maxX=Math.max(...nodes.map(n=>n.x+(document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`)?.offsetWidth||270))),maxY=Math.max(...nodes.map(n=>n.y+(document.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`)?.offsetHeight||220)));const minX=Math.min(...xs),minY=Math.min(...ys),scale=Math.max(.25,Math.min(1.5,(rect.width-100)/(maxX-minX+80),(rect.height-80)/(maxY-minY+80)));state.zoom=scale;state.panX=(rect.width-(maxX-minX)*scale)/2-minX*scale;state.panY=(rect.height-(maxY-minY)*scale)/2-minY*scale;applyCanvasTransform();scheduleDrawEdges();}
  function startPan(event){state.panning={x:event.clientX,y:event.clientY,panX:state.panX,panY:state.panY};$('#viewport').classList.add('panning');try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}event.preventDefault();}
  function movePan(event){if(!state.panning)return;state.panX=state.panning.panX+event.clientX-state.panning.x;state.panY=state.panning.panY+event.clientY-state.panning.y;applyCanvasTransform();scheduleDrawEdges();}
  function endPan(){state.panning=null;$('#viewport').classList.remove('panning');}

  function startSelectionMarquee(event){
    if(event.button!==0||state.handMode||state.spaceDown||event.target.closest('.node,.canvas-note,.canvas-tools,button'))return;
    const viewport=$('#viewport'),bounds=viewport.getBoundingClientRect(),keep=event.shiftKey||event.ctrlKey||event.metaKey;
    if(state.groupDrawMode){const box=document.createElement('div');box.className='group-marquee';viewport.appendChild(box);state.groupMarquee={startX:event.clientX,startY:event.clientY,bounds,box};try{viewport.setPointerCapture(event.pointerId);}catch{}event.preventDefault();return;}
    if(!keep){state.selectedNodeIds=[];state.selectedNodeId=null;state.selectedEdgeIds=[];document.querySelectorAll('.node.selected').forEach(node=>node.classList.remove('selected'));scheduleDrawEdges();}
    const box=document.createElement('div');box.className='selection-marquee';viewport.appendChild(box);
    state.selectionMarquee={startX:event.clientX,startY:event.clientY,bounds,box,keep,initial:[...state.selectedNodeIds],initialEdges:keep?[...state.selectedEdgeIds]:[]};
    try{viewport.setPointerCapture(event.pointerId);}catch{}event.preventDefault();
  }
  function moveSelectionMarquee(event){const drag=state.selectionMarquee;if(!drag)return;const left=Math.min(event.clientX,drag.startX),top=Math.min(event.clientY,drag.startY),right=Math.max(event.clientX,drag.startX),bottom=Math.max(event.clientY,drag.startY);Object.assign(drag.box.style,{left:`${left-drag.bounds.left}px`,top:`${top-drag.bounds.top}px`,width:`${right-left}px`,height:`${bottom-top}px`});const selected=new Set(drag.initial);for(const node of document.querySelectorAll('.node')){const r=node.getBoundingClientRect();if(r.right>=left&&r.left<=right&&r.bottom>=top&&r.top<=bottom)selected.add(node.dataset.id);}state.selectedNodeIds=[...selected];state.selectedNodeId=state.selectedNodeIds.at(-1)||null;document.querySelectorAll('.node').forEach(node=>node.classList.toggle('selected',selected.has(node.dataset.id)));const selectedEdges=new Set(drag.initialEdges);for(const path of edgesSvg.querySelectorAll('.edge[data-edge-id]')){const matrix=path.getScreenCTM();if(!matrix)continue;const length=path.getTotalLength();for(let point=0;point<=length;point+=Math.max(8,length/60)){const p=new DOMPoint(path.getPointAtLength(point).x,path.getPointAtLength(point).y).matrixTransform(matrix);if(p.x>=left&&p.x<=right&&p.y>=top&&p.y<=bottom){selectedEdges.add(path.dataset.edgeId);break;}}}state.selectedEdgeIds=[...selectedEdges];scheduleDrawEdges();}
  function endSelectionMarquee(){const drag=state.selectionMarquee;if(!drag)return;drag.box.remove();state.selectionMarquee=null;}

  function moveGroupMarquee(event){const drag=state.groupMarquee;if(!drag)return;const left=Math.min(event.clientX,drag.startX),top=Math.min(event.clientY,drag.startY),right=Math.max(event.clientX,drag.startX),bottom=Math.max(event.clientY,drag.startY);Object.assign(drag.box.style,{left:`${left-drag.bounds.left}px`,top:`${top-drag.bounds.top}px`,width:`${right-left}px`,height:`${bottom-top}px`});}
  function finishGroupMarquee(event){const drag=state.groupMarquee;if(!drag)return;const left=Math.min(event.clientX,drag.startX),top=Math.min(event.clientY,drag.startY),right=Math.max(event.clientX,drag.startX),bottom=Math.max(event.clientY,drag.startY);drag.box.remove();state.groupMarquee=null;const width=right-left,height=bottom-top;if(width<60||height<45){setGroupDrawMode(false);setRunStatus('Vùng nhóm quá nhỏ. Hãy kéo rộng hơn.','warn');return;}const zoom=state.zoom,viewport=drag.bounds,x=(left-viewport.left-state.panX)/zoom,y=(top-viewport.top-state.panY)/zoom,w=width/zoom,h=height/zoom,nodeIds=[...document.querySelectorAll('.node')].filter(element=>{const rect=element.getBoundingClientRect();return rect.left>=left&&rect.right<=right&&rect.top>=top&&rect.bottom<=bottom;}).map(element=>element.dataset.id);createUndoSnapshot('Tạo vùng nhóm');state.groups.push({id:uid('group'),name:`Nhóm ${state.groups.length+1}`,x,y,width:w,height:h,nodeIds});setGroupDrawMode(false);render();saveState();setRunStatus(`Đã tạo vùng nhóm${nodeIds.length?` quanh ${nodeIds.length} node`:''}.`,'ok');}
  function cancelGroupMarquee(){const drag=state.groupMarquee;if(drag){drag.box.remove();state.groupMarquee=null;}setGroupDrawMode(false);}
  function setGroupDrawMode(active){state.groupDrawMode=Boolean(active);$('#groupTool')?.classList.toggle('active',state.groupDrawMode);$('#groupTool')?.setAttribute('aria-pressed',String(state.groupDrawMode));$('#viewport').classList.toggle('group-draw-mode',state.groupDrawMode);if(state.groupDrawMode)setRunStatus('Đang vẽ nhóm: kéo trên canvas để khoanh vùng. Bấm G hoặc Esc để huỷ.','warn');}

  function openCanvasMenu(e){
    const nodeEl=e.target.closest('.node');e.preventDefault();e.stopPropagation();
    if(!nodeEl){const rect=$('#viewport').getBoundingClientRect(),menu=$('#canvasMenu');state.contextPoint={x:(e.clientX-rect.left-state.panX)/state.zoom,y:(e.clientY-rect.top-state.panY)/state.zoom};menu.innerHTML='';delete menu.dataset.nodeId;const title=document.createElement('div');title.className='menu-caption';title.textContent='Canvas';menu.appendChild(title);[['✏️ Câu lệnh','add:prompt'],['🗒️ Ghi chú','add:text'],['⛔ Tránh (Negative)','add:negativePrompt'],['🖼️ Ảnh đầu vào','add:imageInput'],['🔒 Khóa nhân vật','add:character'],['🧩 Gom ảnh tham chiếu','add:references'],['🎨 Tạo ảnh','add:generateImage'],['🎬 Tạo video','add:generateVideo'],['🎞️ Timeline','add:timeline'],['👁️ Xem trước','add:preview'],['💾 Lưu workflow','save'],['▶ Chạy tất cả','run'],['Sắp xếp node','arrange'],['Xoá node đang chọn','delete-selected'],['Gỡ mọi dây nối','disconnect-all']].forEach(([label,action])=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.contextAction=action;menu.appendChild(button);});menu.classList.remove('hidden');menu.style.left=`${Math.min(e.clientX,innerWidth-230)}px`;menu.style.top=`${Math.min(e.clientY,innerHeight-420)}px`;return;}
    e.stopPropagation();const node=nodeById(nodeEl.dataset.id);if(!node)return;state.selectedNodeId=node.id;
    const menu=$('#canvasMenu');menu.innerHTML='';menu.dataset.nodeId=node.id;
    const title=document.createElement('div');title.className='menu-caption';title.textContent=node.data.customName||nodeDefs[node.type].title;menu.appendChild(title);
    const addAction=(label,action)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.contextAction=action;menu.appendChild(button);};
    addAction('Đổi tên node…','node-rename');
    if(['generateImage','generateVideo'].includes(node.type))addAction(node.data.status==='running'?`■ Dừng tạo ${node.type==='generateVideo'?'video':'ảnh'}`:`▶ Tạo ${node.type==='generateVideo'?'video':'ảnh'}`,'node-run');
    if(node.type==='generateVideo')addAction('↻ Tạo lại · bám sát câu lệnh hơn','node-again');
    if(node.type==='timeline')addAction('▶ Xem thử cả chuỗi','node-preview');
    if((nodeDefs[node.type]?.outputs||[]).some(port=>port.type==='text'))addAction('Tạo node Gộp chữ','node-create-text-merge');
    if((nodeDefs[node.type]?.outputs||[]).some(port=>['image','video'].includes(port.type)))addAction('Tạo node Xem trước','node-create-preview');
    if(node.type==='imageInput')addAction('Chọn / đổi ảnh','node-choose-image');
    if(node.type==='imageResize')addAction('Tải ảnh đã đổi kích thước','node-download-image');
    if(node.type==='preview')addAction('Tải ảnh/video xuống','node-download-preview');
    if(node.type==='prompt'||node.type==='negativePrompt'||node.type==='textAppend')addAction('Sửa nội dung chữ','node-focus-text');
    addAction('Nhân bản node','node-duplicate');addAction('Gỡ dây của node','node-disconnect');addAction('Xoá node','node-delete');
    menu.classList.remove('hidden');menu.style.left=`${Math.min(e.clientX,innerWidth-230)}px`;menu.style.top=`${Math.min(e.clientY,innerHeight-380)}px`;
  }
  function openEdgeMenu(e){
    const hit=e.target.closest('.edge-hit[data-edge-id]');if(!hit)return;
    e.preventDefault();e.stopPropagation();const menu=$('#canvasMenu');menu.innerHTML='';menu.dataset.edgeId=hit.dataset.edgeId;delete menu.dataset.nodeId;
    const title=document.createElement('div');title.className='menu-caption';title.textContent='Dây nối';menu.appendChild(title);
    const button=document.createElement('button');button.type='button';button.textContent='Xoá dây nối';button.dataset.contextAction='edge-delete';menu.appendChild(button);
    menu.classList.remove('hidden');menu.style.left=`${Math.min(e.clientX,innerWidth-230)}px`;menu.style.top=`${Math.min(e.clientY,innerHeight-120)}px`;
  }
  function selectEdgePointer(e){if(e.button!==0)return;const hit=e.target.closest('.edge-hit[data-edge-id]');if(!hit)return;e.preventDefault();e.stopPropagation();const id=hit.dataset.edgeId;state.selectedEdgeIds=e.shiftKey?[...new Set([...state.selectedEdgeIds,id])]:[id];scheduleDrawEdges();}
  function closeCanvasMenu(){ $('#canvasMenu').classList.add('hidden'); }
  function runNodeContextAction(action){const menu=$('#canvasMenu'),node=nodeById(menu.dataset.nodeId);if(!node)return;closeCanvasMenu();
    if(action==='node-rename'){const current=node.data.customName||`${nodeDefs[node.type].title}${node.data.sceneLabel?` · ${node.data.sceneLabel}`:''}`,name=window.prompt('Nhập tên cho node này:',current);if(name===null)return;const trimmed=name.trim();if(!trimmed){setRunStatus('Tên node không được để trống.','warn');return;}createUndoSnapshot('Đổi tên node');node.data.customName=trimmed;render();saveState();setRunStatus('Đã đổi tên node.','ok');return;}
    if(action==='node-run'){runSingleNode(node.id);return;}if(action==='node-again'){executeGenerationNode(node.id,{again:true});return;}if(action==='node-preview'){playTimeline(node);return;}if(action==='node-delete'){removeNode(node.id);return;}
    if(action==='node-create-text-merge'){const output=(nodeDefs[node.type]?.outputs||[]).find(port=>port.type==='text');if(!output)return;createUndoSnapshot('Tạo node Gộp chữ');const target=makeNode('textConcat',node.x+350,node.y);target.data={separator:', '};state.nodes.push(target);state.edges.push({id:uid('edge'),source:node.id,sourcePort:output.id,target:target.id,targetPort:'text'});render();saveState();setRunStatus('Đã tạo node Gộp chữ và nối vào đầu ra này.','ok');return;}
    if(action==='node-create-preview'){const output=(nodeDefs[node.type].outputs||[]).find(port=>['image','video'].includes(port.type));if(output){createUndoSnapshot('Tạo node Xem trước');const target=makeNode('preview',node.x+350,node.y);state.nodes.push(target);state.connectingFrom={nodeId:node.id,portId:output.id};connect(target.id,'media');}return;}
    if(action==='node-disconnect'){if(state.edges.some(edge=>edge.source===node.id||edge.target===node.id)){createUndoSnapshot('Gỡ dây của node');state.edges=state.edges.filter(edge=>edge.source!==node.id&&edge.target!==node.id);render();saveState();setRunStatus('Đã gỡ dây của node.','ok');}return;}
    const el=document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`);
    if(action==='node-focus-text'){el?.querySelector('textarea')?.focus();return;}
    if(action==='node-choose-image'){el?.querySelector('input[type="file"]')?.click();return;}
    if(action==='node-download-image'||action==='node-download-preview'){const url=node.data.asset?.url;if(url){const link=document.createElement('a');link.href=url;link.download=node.data.asset.name||'thekey-output';link.click();}else setRunStatus('Node này chưa có kết quả để tải.','warn');return;}
    if(action==='node-duplicate'){createUndoSnapshot('Nhân bản node');const copy=structuredClone(node);copy.id=uid(node.type);copy.x+=36;copy.y+=36;copy.data={...copy.data};state.nodes.push(copy);if(['generateImage','generateVideo'].includes(copy.type)){const references=state.nodes.find(item=>item.type==='references');if(references)connectReferenceNode(references,copy);}render();saveState();setRunStatus('Đã nhân bản node.','ok');}
  }
  function arrangeNodes(){
    try{
      const order=topoOrder().filter(id=>!nodeById(id)?.data?.dockOnly),level=new Map(order.map(id=>[id,0]));
      for(const id of order)for(const edge of state.edges.filter(e=>e.source===id&&level.has(e.target)))level.set(edge.target,Math.max(level.get(edge.target)||0,(level.get(id)||0)+1));
      const groups=new Map();for(const id of order){const l=level.get(id)||0;if(!groups.has(l))groups.set(l,[]);groups.get(l).push(id);}
      createUndoSnapshot('Sắp xếp node');for(const [l,ids] of groups.entries())ids.forEach((id,row)=>{const node=nodeById(id);node.x=70+l*350;node.y=60+row*260;});
      render();setRunStatus('Đã sắp xếp node theo thứ tự chạy.','ok');
    }catch(error){setRunStatus(error.message,'error');}
  }
  function runCanvasAction(action){
    if(action==='edge-delete'){const menu=$('#canvasMenu'),edgeId=menu.dataset.edgeId;closeCanvasMenu();if(!edgeId)return;const before=state.edges.length;if(state.edges.some(edge=>edge.id===edgeId))createUndoSnapshot('Xoá dây nối');state.edges=state.edges.filter(edge=>edge.id!==edgeId);delete menu.dataset.edgeId;if(state.edges.length!==before){render();saveState();setRunStatus('Đã xoá dây nối.','ok');}return;}
    if(action.startsWith('node-')){runNodeContextAction(action);return;}
    closeCanvasMenu();const pos=state.contextPoint;
    if(action==='add:text'){addTextNote(pos.x,pos.y);return;}
    if(action.startsWith('add:')){addNode(action.slice(4),pos.x,pos.y);return;}
    if(action==='save'){saveState();return;}if(action==='run'){executeWorkflow();return;}if(action==='arrange'){arrangeNodes();return;}
    if(action==='delete-selected'){if(state.selectedNodeIds.length)removeSelectedNodes();else if(state.selectedNodeId)removeNode(state.selectedNodeId);else setRunStatus('Hãy chọn ít nhất một node.','warn');return;}
    if(action==='disconnect-all'){if(state.edges.length){createUndoSnapshot('Gỡ mọi dây nối');state.edges=[];state.connectingFrom=null;render();saveState();setRunStatus('Đã gỡ mọi dây nối.','ok');}}
  }

  function getIncoming(nodeId, targetPort) { return state.edges.filter(e => e.target===nodeId && (!targetPort || e.targetPort===targetPort)); }
  function sourceFor(edge) { return edge ? nodeById(edge.source) : null; }

  function resolveText(nodeId,seen=new Set()){
    if(seen.has(nodeId))return '';seen.add(nodeId);
    const node=nodeById(nodeId);if(!node)return '';
    if(['prompt','negativePrompt'].includes(node.type))return String(node.data?.text??node.data?.prompt??node.data?.value??'');
    if(node.type==='textAppend'){
      const parent=sourceFor(getIncoming(nodeId,'text')[0]);
      return [parent?resolveText(parent.id,new Set(seen)):'' ,String(node.data?.text??'')].filter(value=>value.trim()).join(' ');
    }
    if(node.type==='textConcat'){
      const inputs=getIncoming(nodeId,'text').map(sourceFor).filter(Boolean).map(source=>resolveText(source.id,new Set(seen))).filter(Boolean);
      return inputs.join(node.data.separator??', ');
    }
    const source=sourceFor(getIncoming(nodeId,'text')[0]);return source?resolveText(source.id,seen):'';
  }
  function resolvePrompt(nodeId){
    return getIncoming(nodeId,'prompt').map(edge=>nodeById(edge.source)).filter(Boolean).map(source=>resolveText(source.id).trim()).filter(Boolean).join('\n\n');
  }
  function resolveNegativePrompt(nodeId){const source=sourceFor(getIncoming(nodeId,'negative')[0]);return source?resolveText(source.id):'';}
  function timelinePredecessor(nodeId){const timeline=state.nodes.find(item=>item.type==='timeline'),order=timeline?.data?.clipOrder||[],index=order.indexOf(nodeId);return index>0?nodeById(order[index-1]):null;}
  function resolveReferences(nodeId){
    const references=[],seen=new Set();
    const add=(url,name,role)=>{if(url&&!seen.has(url)){seen.add(url);references.push({url,name:name||`Reference ${references.length+1}`,role:IMAGE_ROLES[role]?role:''});}};
    const visit=(source,sourcePort,visited=new Set())=>{if(!source||visited.has(source.id))return;visited.add(source.id);if(source.type==='references'){for(const edge of getIncoming(source.id))visit(nodeById(edge.source),edge.sourcePort,visited);return;}if(sourcePort==='endFrame'){add(source.data?.endFrame?.url,source.data?.endFrame?.name);return;}if(source.type==='imageInput'&&source.data?.localDataUrl){add(source.data.localDataUrl,'Input image',source.data.role);return;}if(source.data?.asset?.kind==='image')add(source.data.asset.url,source.data.asset.name,source.data.outputRole);};
    const node=nodeById(nodeId),previous=node?.type==='generateVideo'&&node.data?.continuity?timelinePredecessor(nodeId):null;if(previous)add(previous.data?.endFrame?.url,`Khung nối tiếp · ${previous.data?.endFrame?.name||'cuối clip trước'}`);
    for(const edge of getIncoming(nodeId,'reference'))visit(nodeById(edge.source),edge.sourcePort);
    return references;
  }

  function topoOrder() {
    const indeg=new Map(state.nodes.map(n=>[n.id,0])), outgoing=new Map(state.nodes.map(n=>[n.id,[]]));
    state.edges.forEach(e=>{if(!indeg.has(e.source)||!indeg.has(e.target))return;indeg.set(e.target,indeg.get(e.target)+1);outgoing.get(e.source).push(e.target);});
    for(const node of state.nodes.filter(item=>item.type==='generateVideo'&&item.data?.continuity)){const previous=timelinePredecessor(node.id);if(previous&&previous.id!==node.id&&!outgoing.get(previous.id).includes(node.id)){outgoing.get(previous.id).push(node.id);indeg.set(node.id,indeg.get(node.id)+1);}}
    const timeline=state.nodes.find(item=>item.type==='timeline'),orderedVideos=(timeline?.data?.clipOrder||[]).filter(id=>nodeById(id)?.type==='generateVideo');
    for(const node of state.nodes)if(node.type==='generateVideo'&&!orderedVideos.includes(node.id))orderedVideos.push(node.id);
    const videoRank=new Map(orderedVideos.map((id,index)=>[id,index])),nodeRank=new Map(state.nodes.map((node,index)=>[node.id,index]));
    const priority=id=>{const item=nodeById(id);return item?.type==='generateVideo'?state.nodes.length+1+(videoRank.get(id)??nodeRank.get(id)):nodeRank.get(id)??0;};
    const q=state.nodes.filter(n=>indeg.get(n.id)===0).map(n=>n.id), out=[];
    while(q.length){q.sort((a,b)=>priority(a)-priority(b));const id=q.shift();out.push(id);for(const target of outgoing.get(id)){indeg.set(target,indeg.get(target)-1);if(indeg.get(target)===0)q.push(target);}}
    if(out.length!==state.nodes.length) throw new Error('Workflow có vòng lặp. Hãy gỡ vòng lặp trước.'); return out;
  }

  function requiredNodeOrder(targetId){
    const required=new Set();
    const visit=id=>{if(required.has(id))return;required.add(id);for(const edge of state.edges.filter(item=>item.target===id))visit(edge.source);const node=nodeById(id),previous=node?.type==='generateVideo'&&node.data?.continuity?timelinePredecessor(id):null;if(previous)visit(previous.id);};
    visit(targetId);return topoOrder().filter(id=>required.has(id));
  }

  function validateTargetPrompt(targetId){
    const target=nodeById(targetId);if(!target||!['generateImage','generateVideo'].includes(target.type))throw new Error('Node tạo đã chọn không còn tồn tại.');
    const prompt=resolvePrompt(targetId);if(prompt.trim())return prompt;
    const edge=getIncoming(targetId,'prompt')[0],source=edge&&nodeById(edge.source);
    const detail=!edge?'Hãy nối node Câu lệnh, Nối thêm chữ hoặc Gộp chữ vào cổng câu lệnh.':!source?'Node câu lệnh đã nối không còn tồn tại.':`Node ${nodeDefs[source.type]?.title||'chữ'} đã nối chưa có nội dung.`;
    target.data.status='error';target.data.error=detail;
    render();throw new Error(`${nodeDefs[target.type]?.title||'Node tạo nội dung'} ${target.id}: ${detail}`);
  }

  const FLOW_TAB_URLS=['https://flow.google.com/*','https://labs.google/fx/*'];
  const FLOW_TAB_RX=/^https:\/\/(?:flow\.google\.com|labs\.google\/fx)\//i;
  let preferredMuseTabId=null;
  // Sends a THEKEY_FLOW_* message to the signed-in Flow tab, injecting the bridge if the tab predates the extension.
  async function museTabMessage(message, preferredTabId, signal) {
    if(signal?.aborted)throw new DOMException('Đã dừng theo yêu cầu.','AbortError');
    const tabs=await chrome.tabs.query({url:FLOW_TAB_URLS});
    if(!tabs.length)throw new Error('Hãy mở Google Flow (flow.google.com), đăng nhập và mở một dự án rồi thử lại.');
    const preferred=preferredTabId??preferredMuseTabId;
    tabs.sort((a,b)=>(b.id===preferred)-(a.id===preferred)||(b.active-a.active));
    const outgoing={...message,selectors:flowSelectorOverrides(),inputMode:state.settings?.inputMode||'auto'};
    let lastError='';
    for(const tab of tabs){
      if(signal?.aborted)throw new DOMException('Đã dừng theo yêu cầu.','AbortError');
      if(!tab.id)continue;
      try{const response=await sendMuseTabMessage(tab.id,outgoing,signal);preferredMuseTabId=tab.id;return response;}catch(error){if(error?.name==='AbortError')throw error;lastError=error?.message||String(error);}
      try{
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:['flow-page-hook.js'],world:'MAIN'}).catch(()=>{});
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:['flow-bridge.js']});
        const response=await sendMuseTabMessage(tab.id,outgoing,signal);preferredMuseTabId=tab.id;return response;
      }catch(error){if(error?.name==='AbortError')throw error;lastError=error?.message||String(error);}
    }
    throw new Error(`Đã thấy tab Flow nhưng TheKey.studio không gắn được vào trang: ${lastError||'lỗi trình duyệt không rõ'}. Kiểm tra quyền truy cập flow.google.com của extension rồi thử lại.`);
  }

  function sendMuseTabMessage(tabId,message,signal){
    if(!signal)return chrome.tabs.sendMessage(tabId,message);
    if(signal.aborted)return Promise.reject(new DOMException('Đã dừng theo yêu cầu.','AbortError'));
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',onAbort);fn(value);};
      const onAbort=()=>finish(reject,new DOMException('Đã dừng theo yêu cầu.','AbortError'));
      signal.addEventListener('abort',onAbort,{once:true});
      chrome.tabs.sendMessage(tabId,message).then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  }

  function stopGeneration(nodeId=state.activeGenerationId){
    if(!nodeId)return;
    const node=nodeById(nodeId);
    if(!node||node.data.status!=='running')return;
    const requestId=state.activeGenerationId===nodeId?state.generationRequestId:null;
    if(state.activeGenerationId===nodeId)state.generationAbortController?.abort();
    if(node){node.data.status='stopped';node.data.error='Đã dừng theo yêu cầu.';}
    setRunStatus(`Đã dừng tạo ${node?.type==='generateVideo'?'video':'ảnh'}: ${nodeId}`,'warn');
    render();
    // Cancellation is best-effort for Flow, but never wait for its response to unlock the UI.
    void sendMuseStop(requestId);
    try{clearTimeout(autoSaveTimer);void queueWorkflowSave();}catch{}
  }

  async function sendMuseStop(requestId){
    try{
      const tabs=await chrome.tabs.query({url:FLOW_TAB_URLS});
      const ordered=preferredMuseTabId?tabs.sort((a,b)=>(b.id===preferredMuseTabId)-(a.id===preferredMuseTabId)):tabs;
      await Promise.allSettled(ordered.filter(tab=>tab.id).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'THEKEY_FLOW_STOP_GENERATION',requestId})));
    }catch{}
  }

  async function testMuseSession(preferredTabId) {
    const button=$('#testMuseBtn'),status=$('#connectionStatus');
    if(button)button.disabled=true;
    try{
      if(providerName()==='api'){
        status.className='warn';status.textContent='Đang kiểm tra Gemini API key…';
        const result=await window.TheKeyGeminiApi.checkKey(await getApiKey());
        status.className='ok';status.textContent=`API key dùng được. Model Veo: ${result.veo.join(', ')||'không có'}.`;
        museStatus.textContent='● Gemini API sẵn sàng';museStatus.className='ok';
        return true;
      }
      status.className='warn';status.textContent='Đang kiểm tra tab Flow…';
      const result=await museTabMessage({type:'THEKEY_FLOW_CHECK_SESSION'},preferredTabId);
      const ready=Boolean(result?.ready);
      status.className=ready?'ok':'warn';
      status.textContent=ready?'Dự án Flow đang mở và sẵn sàng.':result?.loginRequired?'Flow đang yêu cầu đăng nhập. Hãy đăng nhập trong tab Flow rồi kiểm tra lại.':'Đã thấy tab Flow nhưng chưa thấy ô nhập. Hãy mở một dự án trong Flow rồi kiểm tra lại.';
      museStatus.textContent=ready?'● Flow sẵn sàng':result?.loginRequired?'● Hãy đăng nhập Flow':'● Hãy mở một project trên Flow';
      museStatus.className=ready?'ok':'warn';
      return ready;
    }catch(error){
      status.className='error';status.textContent=error.message;
      museStatus.textContent=providerName()==='api'?'● Kiểm tra Gemini API thất bại':'● Kiểm tra Flow thất bại';museStatus.className='error';
      return false;
    }finally{if(button)button.disabled=false;}
  }

  async function execute(targetId=null,{again=false}={}) {
    if(state.isRunning)return;
    // Keep runtime graph references valid even if an older saved workflow or
    // an interrupted UI action left stale node IDs behind.
    normalizeSavedGraph();
    // A persisted "running" flag can survive a tab reload even though the old
    // request no longer exists. Normalize it before starting a fresh run.
    for(const node of state.nodes)if(['generateImage','generateVideo'].includes(node.type)&&node.data.status==='running'){
      node.data.status=node.data.asset?.url?'success':'idle';
      if(node.data.status==='idle')node.data.error='Lần chạy trước bị ngắt; có thể chạy lại.';
    }
    const abortController=new AbortController();state.generationAbortController=abortController;state.activeGenerationId=targetId;state.isRunning=true;$('#runBtn').disabled=false;$('#runBtn').textContent='■ Dừng tất cả';$('#runBtn').title='Dừng workflow và các node còn lại';
    setRunStatus(targetId?(again?'Đang tạo lại video…':'Đang chạy node đã chọn…'):'Đang chạy workflow...','warn');
    try{
      if(targetId)validateTargetPrompt(targetId);
      const order=targetId?requiredNodeOrder(targetId).filter(id=>{const prerequisite=nodeById(id);return id===targetId||!['generateImage','generateVideo'].includes(prerequisite?.type)||!prerequisite.data?.asset?.url;}):topoOrder();
      for(const n of state.nodes){
        if(n.type==='imageInput'&&n.data.localDataUrl)n.data.asset={id:n.data.asset?.id||uid('asset'),kind:'image',url:n.data.localDataUrl,sourceNodeId:n.id};
      }
      let generationStep=0;
      // A full run keeps finished results (use Run/Again on a node to regenerate it) and
      // carries on past a failed node, skipping only the nodes that depend on it.
      const failed=new Set();let skippedDone=0;
      const isDone=node=>node?.data?.status==='success'&&Boolean(node.data.asset?.url);
      const totalGenerations=order.filter(id=>['generateImage','generateVideo'].includes(nodeById(id)?.type)&&(targetId||!isDone(nodeById(id)))).length;
      for(const id of order){
        if(abortController.signal.aborted)throw new DOMException('Đã dừng theo yêu cầu.','AbortError');
        const n=nodeById(id); if(!n)continue;
        if(n.type==='imageResize'){
          const source=sourceFor(getIncoming(n.id,'image')[0]);const url=source?.data?.localDataUrl||source?.data?.asset?.url;
          if(!url){setRunStatus('Node Đổi kích thước đang chờ ảnh đầu vào.','warn');continue;}
          const image=await loadImage(url),canvas=document.createElement('canvas');drawResized(image,canvas,n.data);
          const resized=canvas.toDataURL('image/png');n.data.asset={id:uid('asset'),kind:'image',url:resized,name:`Resized ${n.data.width}×${n.data.height}`,width:canvas.width,height:canvas.height,sourceNodeId:n.id};
          state.edges.filter(e=>e.source===n.id).forEach(e=>{const target=nodeById(e.target);if(target?.type==='preview')target.data.asset=n.data.asset;});render();continue;
        }
        if(['generateImage','generateVideo'].includes(n.type)){
          if(!targetId){
            if(isDone(n)){skippedDone++;continue;}
            const blockedBy=requiredNodeOrder(n.id).find(other=>other!==n.id&&failed.has(other));
            if(blockedBy){failed.add(n.id);n.data.status='error';n.data.error=`Bỏ qua: ${nodeById(blockedBy)?.data?.customName||blockedBy} bị lỗi trước đó.`;render();continue;}
          }
          try{
          const isVideo=n.type==='generateVideo';
          generationStep++;
          const prompt=resolvePrompt(n.id); if(!String(prompt).trim()) throw new Error(`${nodeDefs[n.type].title}: hãy nối node Câu lệnh trước.`);
          const negativePrompt=resolveNegativePrompt(n.id);
          const continuityPrevious=isVideo&&n.data.continuity?timelinePredecessor(n.id):null,continuityStartFrame=continuityPrevious?.data?.endFrame?.url?continuityPrevious.data.endFrame:null;
          if(isVideo&&n.data.continuity&&!continuityStartFrame)throw new Error(`Nối khung cuối cần clip trước trong Timeline đã tạo xong. Hãy xếp đúng thứ tự và chạy clip trước.`);
          const referenceImages=resolveReferences(n.id);
          state.activeGenerationId=n.id;n.data.status='running';n.data.error='';n.data.asset=null;n.data.endFrame=null;state.edges.filter(edge=>edge.source===n.id).forEach(edge=>{const target=nodeById(edge.target);if(target?.type==='preview')target.data.asset=null;});render();setRunStatus(`${targetId?'Node đã chọn':`Lượt ${generationStep}/${totalGenerations}`} · đang tạo ${isVideo?'video':'ảnh'}: ${n.id}`,'warn');
          try{
const reply=await generateWithProvider(n,{isVideo,prompt,negativePrompt,referenceImages,continuityStartFrame},abortController.signal);
            if(abortController.signal.aborted)throw new DOMException('Đã dừng theo yêu cầu.','AbortError');
            if(!reply?.ok)throw Object.assign(new Error(reply?.error||`Không nhận được ${isVideo?'video':'ảnh'}.`),{code:reply?.code||''});
            const kind=isVideo?'video':'image';
            const url=isVideo?await persistVideo(reply.url):await persistImage(reply.url);
            if(!url)throw new Error(`Kết quả trả về bị rỗng.`);
            const intrinsic=await mediaDimensions(url,isVideo?'video':'image');
            const actualRatio=intrinsic.width&&intrinsic.height?intrinsic.width/intrinsic.height:0;
            const expectedRatio=ratioValue(n.data.size);
            const sizeMismatch=actualRatio&&Math.abs(Math.log(actualRatio/expectedRatio))>0.09;
            n.data.asset={id:uid('asset'),kind,url,name:`${isVideo?'Video':'Image'} ${n.id}`,sourceNodeId:n.id,width:intrinsic.width,height:intrinsic.height,requestedSize:n.data.size,sizeMismatch}; n.data.status='success';
            if(isVideo)n.data.endFrame=await extractVideoEndFrame(url);
            // Keep a mismatched result (credits are already spent) and flag it on the node.
            if(sizeMismatch){n.data.error=`Yêu cầu ${n.data.size}, nhận ${intrinsic.width}×${intrinsic.height}. Kết quả trả về khác tỉ lệ; vẫn giữ kết quả.`;setRunStatus(`${n.data.customName||n.id}: khác tỉ lệ yêu cầu, vẫn giữ kết quả.`,'warn');}
            if(reply.warnings?.length)n.data.error=[n.data.error,...reply.warnings].filter(Boolean).join(' ');
            state.edges.filter(e=>e.source===n.id).forEach(e=>{const target=nodeById(e.target);if(target?.type==='preview')target.data.asset=e.sourcePort==='endFrame'?n.data.endFrame:n.data.asset;});render();
          }catch(err){if(err?.name==='AbortError'||abortController.signal.aborted){n.data.status='stopped';n.data.error='Đã dừng theo yêu cầu.';render();throw new DOMException('Đã dừng theo yêu cầu.','AbortError');}n.data.status='error';n.data.error=err?.message||String(err);render();throw err;}
          }catch(err){
            if(targetId||err?.name==='AbortError'||abortController.signal.aborted)throw err;
            // Flow blocked the session or ran out of credits: stop the whole run instead of sending more requests.
            if(['FLOW_BLOCKED','NO_CREDITS'].includes(err?.code)){failed.add(n.id);throw err;}
            failed.add(n.id);if(n.data.status!=='error'){n.data.status='error';n.data.error=err?.message||String(err);render();}
            setRunStatus(`${n.data.customName||n.id} bị lỗi; tiếp tục các node còn lại…`,'warn');
          }
        }
      }
      const skippedNote=skippedDone?` Giữ nguyên ${skippedDone} node đã xong (bấm Tạo lại trên node nếu muốn làm lại).`:'';
      try{clearTimeout(autoSaveTimer);await queueWorkflowSave();if(failed.size)setRunStatus(`Chạy xong, có ${failed.size} node lỗi hoặc bị bỏ qua. Sửa rồi bấm Chạy tất cả lần nữa; node đã xong được giữ nguyên.${skippedNote}`,'error');else setRunStatus(targetId?'Node đã tạo xong.':`Đã chạy xong.${skippedNote}`,'ok');}catch(saveError){setRunStatus(`Đã tạo xong nhưng không lưu được workflow: ${saveError?.message||String(saveError)}`,'warn');}
    }catch(err){
      if(err?.name==='AbortError'||abortController.signal.aborted){
        const active=state.nodes.find(n=>n.id===state.activeGenerationId);
        if(active&&active.data.status==='running'){active.data.status='stopped';active.data.error='Đã dừng theo yêu cầu.';render();}
        try{clearTimeout(autoSaveTimer);await queueWorkflowSave();}catch{}
        return;
      }
      const failed=state.nodes.find(n=>['generateImage','generateVideo'].includes(n.type)&&n.data.status==='running');
      if(failed){failed.data.status='error';failed.data.error=err?.message||String(err);render();}
      const message=err?.message||String(err);
      setRunStatus(/failed to fetch/i.test(message)?'Không kết nối được với tab Flow. Hãy tải lại TheKey.studio Flow rồi kiểm tra tab Flow.':'TheKey.studio Flow 0.3.7 · '+message,'error');
      try{clearTimeout(autoSaveTimer);await queueWorkflowSave();}catch(saveError){setRunStatus(`${runStatus.textContent} · Tự lưu thất bại: ${saveError?.message||String(saveError)}`,'error');}
    }
    finally{state.isRunning=false;state.activeGenerationId=null;state.generationAbortController=null;state.generationRequestId=null;$('#runBtn').disabled=false;$('#runBtn').textContent='▶ Chạy tất cả';$('#runBtn').title='Chạy mọi node theo đúng thứ tự nối dây';render();}
  }

  async function toDataUrl(url){
    if(!url)return '';
    if(url.startsWith('data:'))return url;
    const response=await fetch(url,{credentials:'include'});
    if(!response.ok)throw new Error(`Không đọc được một ảnh đã nối (HTTP ${response.status}).`);
    return blobAsDataUrl(await response.blob());
  }
  function providerName(){return state.settings?.provider==='api'?'api':'flow';}
  async function getApiKey(){try{return (await chrome.storage.local.get('thekeyGeminiApiKey')).thekeyGeminiApiKey||'';}catch{return '';}}
  function flowSelectorOverrides(){const raw=state.settings?.flowSelectors;if(!raw)return undefined;try{return JSON.parse(raw);}catch{return undefined;}}
  // One generation through the chosen provider: the Flow tab (flow-bridge.js) or the Gemini API (veo-api.js).
  async function generateWithProvider(n,{isVideo,prompt,negativePrompt,referenceImages,continuityStartFrame},signal){
    const settings=state.settings||{},provider=providerName(),warnings=[];
    const model=(n.data.model||'').trim()||(provider==='api'?(isVideo?settings.apiVideoModel||'veo-3.1-fast-generate-preview':settings.apiImageModel||'gemini-nano-banana-2.1'):(isVideo?settings.flowVideoModel:settings.flowImageModel)||'');
    const timeoutSec=Number(settings.timeoutSec)||900;
    // Images sent with this scene. Each one can carry a role (model, outfit, product…) from its Image Input
    // node; Character Lock images are always references, never the start frame. The roles are spelled out
    // in the prompt in the same order the images are attached, so Flow knows what each picture is for.
    const characters=n.data.useCharacters===false?[]:state.nodes.filter(node=>node.type==='character'&&node.data.enabled!==false&&(node.data.localDataUrl||String(node.data.description||'').trim()));
    const characterItems=characters.filter(node=>node.data.localDataUrl).map(node=>({url:node.data.localDataUrl,role:'character',name:String(node.data.name||'').trim()||'the main character'}));
    const characterUrls=new Set(characterItems.map(item=>item.url));
    const others=referenceImages.filter(item=>item.url!==continuityStartFrame?.url&&!characterUrls.has(item.url));
    const roleItems=others.filter(item=>item.role&&item.role!=='startFrame'),plain=others.filter(item=>!item.role),startItems=others.filter(item=>item.role==='startFrame');
    let firstFrame=continuityStartFrame?.url||'',items=[];
    if(isVideo){
      if(!firstFrame&&startItems.length)firstFrame=startItems[0].url;
      items=[...characterItems,...roleItems,...plain];
      // Veo (Flow and Gemini API) animates either one start frame or a set of reference images, never both.
      if(!firstFrame&&plain.length&&(n.data.referenceMode||'firstFrame')==='firstFrame'){
        if(items.length===1){firstFrame=plain[0].url;items=[];}
        else warnings.push(`Có ${items.length} ảnh nên cả ${items.length} ảnh được gửi làm ảnh tham chiếu. Veo không dùng khung đầu cùng lúc với ảnh tham chiếu.`);
      }
      if(firstFrame&&items.length){warnings.push(`Video bắt đầu từ khung đầu nên ${items.length} ảnh tham chiếu không được gửi kèm (Veo không dùng khung đầu cùng lúc với ảnh tham chiếu).`);items=[];}
    }else items=[...characterItems,...roleItems,...plain,...startItems];
    const maxRefs=provider==='api'||isVideo?3:5;
    if(items.length>maxRefs){warnings.push(`Mỗi cảnh gửi tối đa ${maxRefs} ảnh tham chiếu; đã gửi ${maxRefs} ảnh đầu trong ${items.length} ảnh.`);items=items.slice(0,maxRefs);}
    const references=items.map(item=>item.url);
    const roleText=item=>item.role==='character'?`the character ${item.name}: keep exactly this person (same face, hair, body and outfit)`:IMAGE_ROLES[item.role]?.prompt||'a reference image';
    if(items.some(item=>item.role)){
      const list=[...(firstFrame&&isVideo?['the start frame of the video']:[]),...items.map(roleText)];
      prompt=`${prompt}\n\nAttached images, in order: ${list.map((text,index)=>`image ${index+1} = ${text}`).join('; ')}.`;
    }
    if(characters.length){
      const looks=characters.map(node=>{const name=String(node.data.name||'').trim()||'Main character',text=String(node.data.description||'').trim();return text?`${name}: ${text}.`:'';}).filter(Boolean).join(' ');
      const names=characters.map(node=>String(node.data.name||'').trim()||'the main character').join(', ');
      prompt=`${prompt}\n\nCharacter lock: ${names} must look exactly the same in every scene (same face, hair, body and outfit); do not change the character's appearance.${looks?` ${looks}`:''}`;
    }
    const aspect=isVideo?(n.data.size==='9:16'?'9:16':'16:9'):(n.data.size||'1:1');
    let duration=[4,6,8].includes(Number(n.data.duration))?Number(n.data.duration):8;
    if(isVideo&&provider==='api'&&references.length&&duration!==8){warnings.push('Clip có ảnh tham chiếu luôn dài 8 giây.');duration=8;}
    const images={firstFrame:firstFrame?await toDataUrl(firstFrame):'',references:await Promise.all(references.map(toDataUrl))};
    const requestId=uid('generation');state.generationRequestId=requestId;
    const promptWithAvoid=negativePrompt?`${prompt}\n\nAvoid: ${negativePrompt}`:prompt;
    let reply;
    if(provider==='api'){
      if(!window.TheKeyGeminiApi)throw new Error('Chưa tải được phần Gemini API. Hãy tải lại TheKey.studio Flow.');
      const apiKey=await getApiKey();
      const onStatus=text=>setRunStatus(`${n.data.customName||n.data.sceneLabel||n.id} · ${text}`,'warn');
      reply=isVideo
        ?await window.TheKeyGeminiApi.generateVideo({apiKey,model,prompt,negativePrompt,aspect,duration,resolution:settings.apiResolution||'720p',firstFrame:images.firstFrame,references:images.references,timeoutSec},signal,onStatus)
        :await window.TheKeyGeminiApi.generateImage({apiKey,model,prompt:promptWithAvoid,aspect,references:images.references},signal,onStatus);
    }else{
      reply=await museTabMessage({type:'THEKEY_FLOW_GENERATE',requestId,kind:isVideo?'video':'image',prompt:promptWithAvoid,model,aspect,duration,firstFrame:images.firstFrame,references:images.references,timeoutSec},preferredMuseTabId,signal);
      // Large data: URLs are slow to keep around; hold the video as a Blob instead.
      if(reply?.ok&&reply.url?.startsWith('data:video'))reply.url=URL.createObjectURL(await (await fetch(reply.url)).blob());
      if(reply&&!reply.ok&&reply.code==='SCENE_REFUSED')reply.error=`${reply.error} Hãy sửa câu lệnh rồi chạy lại node.`;
    }
    if(reply)reply.warnings=[...warnings,...(reply.warnings||[])];
    return reply;
  }

  function executeWorkflow(){return execute();}
  function executeGenerationNode(nodeId,options={}){const node=nodeById(nodeId);if(!node||!['generateImage','generateVideo'].includes(node.type))return;if(node.data.status==='running'){stopGeneration(nodeId);return;}return execute(nodeId,options);}
  function runSingleNode(nodeId){return executeGenerationNode(nodeId);}
  function onWorkflowRunButtonClick(event){if(event.detail>1)return;if(state.isRunning)stopGeneration(state.activeGenerationId);else executeWorkflow();}

  function setRunStatus(text, cls=''){runStatus.className=cls;runStatus.textContent=text;}

  function ratioValue(size){const [w,h]=String(size||'1:1').split(':').map(Number);return w>0&&h>0?w/h:1;}

  function clampDimension(value){return Math.max(1,Math.min(4096,Math.round(Number(value)||1)));}

  function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Không đọc được ảnh nối vào để đổi kích thước.'));image.src=url;});}

  function drawResized(image,canvas,data={}){
    const width=clampDimension(data.width||1024),height=clampDimension(data.height||1024);canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)return;context.fillStyle='#101116';context.fillRect(0,0,width,height);
    const fit=data.fit||'cover';let scale=fit==='stretch'?null:fit==='contain'?Math.min(width/image.naturalWidth,height/image.naturalHeight):Math.max(width/image.naturalWidth,height/image.naturalHeight);
    const drawWidth=scale===null?width:image.naturalWidth*scale,drawHeight=scale===null?height:image.naturalHeight*scale;
    context.drawImage(image,(width-drawWidth)/2,(height-drawHeight)/2,drawWidth,drawHeight);
  }

  async function mediaDimensions(url,kind){
    if(kind==='image')return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});image.onerror=()=>resolve({width:0,height:0});image.src=url;});
    return new Promise(resolve=>{const video=document.createElement('video');video.preload='metadata';video.onloadedmetadata=()=>resolve({width:video.videoWidth,height:video.videoHeight});video.onerror=()=>resolve({width:0,height:0});video.src=url;});
  }

  function extractVideoEndFrame(url){return new Promise(resolve=>{const video=document.createElement('video');if(/^https?:/i.test(url))video.crossOrigin='anonymous';video.preload='auto';video.muted=true;video.playsInline=true;let finished=false;const done=value=>{if(finished)return;finished=true;video.removeAttribute('src');video.load();resolve(value);};const timer=setTimeout(()=>done(null),12000);video.onloadedmetadata=()=>{if(!Number.isFinite(video.duration)){clearTimeout(timer);done(null);return;}video.currentTime=Math.max(0,video.duration-Math.min(.04,video.duration/100));};video.onseeked=()=>{try{const width=video.videoWidth,height=video.videoHeight;if(!width||!height){clearTimeout(timer);done(null);return;}const frame=document.createElement('canvas');frame.width=width;frame.height=height;frame.getContext('2d').drawImage(video,0,0,width,height);const dataUrl=frame.toDataURL('image/png');clearTimeout(timer);done({id:uid('endframe'),kind:'image',url:dataUrl,name:'Khung cuối video',width,height});}catch{clearTimeout(timer);done(null);}};video.onerror=()=>{clearTimeout(timer);done(null);};video.src=url;video.load();});}

  async function persistImage(url) {
    if(!url)return '';
    if(url.startsWith('data:'))return url;
    try{
      const response=await fetch(url,{credentials:'include'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const blob=await response.blob();
      if(blob.size>8*1024*1024)return url;
      return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
    }catch{return url;}
  }

  // Remote video links can expire, so keep a local copy that auto-save moves into IndexedDB.
  async function persistVideo(url){
    if(!url||/^(?:data:|blob:)/i.test(url))return url;
    try{
      const response=await fetch(url,{credentials:'include'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const blob=await response.blob();
      if(!blob.size||blob.size>500*1024*1024)return url;
      return URL.createObjectURL(blob.type?blob:new Blob([blob],{type:'video/mp4'}));
    }catch{return url;}
  }

  // blob: URLs belong to this extension page and cannot be read from the Flow tab,
  // so hand the bridge a data: URL instead.
  async function bridgeSafeUrl(url){
    if(!url?.startsWith('blob:'))return url;
    const blob=await (await fetch(url)).blob();
    if(!blob.size)throw new Error('Một ảnh tham chiếu bị rỗng. Hãy chọn lại ảnh.');
    return blobAsDataUrl(blob);
  }

  let mediaDbPromise;
  function mediaDb(){if(!mediaDbPromise)mediaDbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open('museflow-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('assets');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('Không mở được kho lưu ảnh/video trên máy.'));});return mediaDbPromise;}
  async function putMedia(key,blob){const db=await mediaDb();return new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(blob,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Không lưu được ảnh/video vào máy.'));tx.onabort=()=>reject(tx.error||new Error('Việc lưu ảnh/video bị huỷ giữa chừng.'));});}
  async function getMedia(key){const db=await mediaDb();return new Promise((resolve,reject)=>{const request=db.transaction('assets','readonly').objectStore('assets').get(key);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error||new Error('Không đọc được ảnh/video đã lưu.'));});}
  const idbMediaPrefix='museflow-idb:';
  // Remembers which local media URL is already stored under which IndexedDB key, so
  // auto-save does not re-copy every image and video on each edit.
  const storedMediaKeys=new Map();
  function rememberMediaKey(url,key){for(const [known,value] of storedMediaKeys)if(value===key&&known!==url)storedMediaKeys.delete(known);storedMediaKeys.set(url,key);}
  async function dehydrateMediaUrl(url,key){if(!url||url.startsWith(idbMediaPrefix)||!(/^(?:data:|blob:)/i).test(url))return url;if(storedMediaKeys.get(url)===key)return idbMediaPrefix+encodeURIComponent(key);const response=await fetch(url);const blob=await response.blob();if(!blob.size)throw new Error('Một ảnh hoặc video đã lưu bị rỗng.');await putMedia(key,blob);rememberMediaKey(url,key);return idbMediaPrefix+encodeURIComponent(key);}
  // Drop stored media that no saved node refers to any more, so deleted clips do not fill the disk.
  async function pruneMedia(usedKeys){const db=await mediaDb();const keys=await new Promise((resolve,reject)=>{const request=db.transaction('assets','readonly').objectStore('assets').getAllKeys();request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error);});const unused=keys.filter(key=>!usedKeys.has(key));if(!unused.length)return;await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets');unused.forEach(key=>store.delete(key));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});for(const [url,key] of storedMediaKeys)if(!usedKeys.has(key))storedMediaKeys.delete(url);}
  let autoSaveTimer=0,workflowSaveQueue=Promise.resolve();
  async function saveWorkflowSnapshot(){const snapshot=structuredClone({nodes:state.nodes,edges:state.edges,groups:state.groups,notes:state.notes,settings:state.settings});for(const node of snapshot.nodes){const data=node.data||{};if(data.localDataUrl)data.localDataUrl=await dehydrateMediaUrl(data.localDataUrl,`input:${node.id}`);for(const field of ['asset','endFrame']){const media=data[field];if(media?.url)media.url=await dehydrateMediaUrl(media.url,`${field}:${media.id||node.id}`);}}await chrome.storage.local.set({museflow:snapshot});const usedKeys=new Set();for(const node of snapshot.nodes){const data=node.data||{};for(const url of [data.localDataUrl,data.asset?.url,data.endFrame?.url])if(typeof url==='string'&&url.startsWith(idbMediaPrefix))usedKeys.add(decodeURIComponent(url.slice(idbMediaPrefix.length)));}await pruneMedia(usedKeys).catch(()=>{});}
  function queueWorkflowSave(){workflowSaveQueue=workflowSaveQueue.catch(()=>{}).then(saveWorkflowSnapshot);return workflowSaveQueue;}
  function scheduleAutoSave(){clearTimeout(autoSaveTimer);autoSaveTimer=setTimeout(()=>{queueWorkflowSave().catch(error=>{if(runStatus.className!=='error')setRunStatus(`Tự lưu thất bại: ${error?.message||String(error)}`,'error');});},650);}
  async function hydrateMediaUrl(url,cache){if(!url?.startsWith(idbMediaPrefix))return url;const key=decodeURIComponent(url.slice(idbMediaPrefix.length));if(!cache.has(key)){const blob=await getMedia(key),objectUrl=blob?URL.createObjectURL(blob):'';if(objectUrl)rememberMediaKey(objectUrl,key);cache.set(key,objectUrl);}return cache.get(key);}
  async function hydrateWorkflowMedia(){const cache=new Map();for(const node of state.nodes){const data=node.data||{};if(data.localDataUrl)data.localDataUrl=await hydrateMediaUrl(data.localDataUrl,cache);for(const field of ['asset','endFrame'])if(data[field]?.url)data[field].url=await hydrateMediaUrl(data[field].url,cache);}}
  async function saveState(){clearTimeout(autoSaveTimer);try{await queueWorkflowSave();setRunStatus('Đã lưu.','ok');}catch(error){setRunStatus(`Không lưu được workflow: ${error?.message||String(error)}`,'error');}}
  function blobAsDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('Không đóng gói được ảnh/video của workflow.'));reader.readAsDataURL(blob);});}
  async function exportWorkflowFile(){
    const button=$('#workflowExportBtn');button.disabled=true;
    try{
      const workflow=structuredClone({nodes:state.nodes,edges:state.edges,groups:state.groups,notes:state.notes,settings:state.settings});let externalMedia=0;
      const packageUrl=async url=>{
        if(!url||url.startsWith('data:'))return url;
        try{
          let blob;
          if(url.startsWith(idbMediaPrefix))blob=await getMedia(decodeURIComponent(url.slice(idbMediaPrefix.length)));
          else if(/^(?:blob:|https?:)/i.test(url)){const response=await fetch(url,{credentials:'include'});if(!response.ok)throw new Error(`HTTP ${response.status}`);blob=await response.blob();}
          else return url;
          if(!blob?.size)throw new Error('Thiếu ảnh/video hoặc file rỗng');
          return await blobAsDataUrl(blob);
        }catch{externalMedia++;return url;}
      };
      for(const node of workflow.nodes){const data=node.data||{};if(data.localDataUrl)data.localDataUrl=await packageUrl(data.localDataUrl);for(const field of ['asset','endFrame'])if(data[field]?.url)data[field].url=await packageUrl(data[field].url);}
      const file={format:'26flow-workflow',version:1,appVersion:'flow-0.3.7',exportedAt:new Date().toISOString(),workflow};
      const blob=new Blob([JSON.stringify(file)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`TheKey-Workflow-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
      setRunStatus(externalMedia?`Đã lưu file; ${externalMedia} ảnh/video không nhúng được vào file và cần phiên Flow gốc để mở.`:'Đã lưu workflow kèm ảnh/video.','ok');
    }catch(error){setRunStatus(`Không lưu được file workflow: ${error?.message||String(error)}`,'error');}
    finally{button.disabled=false;}
  }
  async function importWorkflowFile(file){
    if(!file)return;if(state.isRunning){setRunStatus('Hãy dừng workflow đang chạy trước khi mở file khác.','warn');return;}
    let parsed,workflow;
    try{parsed=JSON.parse(await file.text());workflow=parsed?.format==='26flow-workflow'?parsed.workflow:parsed;if(!workflow||!Array.isArray(workflow.nodes)||!Array.isArray(workflow.edges))throw new Error('File này không phải workflow TheKey.studio hợp lệ.');}
    catch(error){setRunStatus(`Không mở được file workflow: ${error?.message||String(error)}`,'error');return;}
    if(!window.confirm('Mở file này sẽ thay thế canvas hiện tại. Tiếp tục?'))return;
    createUndoSnapshot('Mở file workflow',{preserveRuntime:false});
    const previous={nodes:state.nodes,edges:state.edges,groups:state.groups,notes:state.notes,settings:state.settings};
    try{
      state.nodes=workflow.nodes;state.edges=workflow.edges;state.groups=Array.isArray(workflow.groups)?workflow.groups:[];state.notes=Array.isArray(workflow.notes)?workflow.notes:[];state.settings=workflow.settings&&typeof workflow.settings==='object'?workflow.settings:{};
      await hydrateWorkflowMedia();normalizeSavedGraph();state.selectedNodeIds=[];state.selectedNodeId=null;state.selectedEdgeIds=[];syncSettingsUI();render();await queueWorkflowSave();
      setRunStatus(`Đã mở workflow: ${file.name}`,'ok');
    }catch(error){state.nodes=previous.nodes;state.edges=previous.edges;state.groups=previous.groups||[];state.notes=previous.notes||[];state.settings=previous.settings;render();setRunStatus(`Không mở được file workflow: ${error?.message||String(error)}`,'error');}
  }
  async function loadState(){try{const got=await chrome.storage.local.get('museflow');if(got.museflow){state.nodes=Array.isArray(got.museflow.nodes)?got.museflow.nodes:[];state.edges=Array.isArray(got.museflow.edges)?got.museflow.edges:[];state.groups=Array.isArray(got.museflow.groups)?got.museflow.groups:[];state.notes=Array.isArray(got.museflow.notes)?got.museflow.notes:[];state.settings=got.museflow.settings||{};if(!state.nodes.length){const s=starter();state.nodes=s.nodes;state.edges=s.edges;}}else{const s=starter();state.nodes=s.nodes;state.edges=s.edges;}await hydrateWorkflowMedia();}catch(error){const s=starter();state.nodes=s.nodes;state.edges=s.edges;state.groups=[];state.notes=[];setRunStatus(`Không mở được workflow đã lưu: ${error.message}`,'error');}normalizeSavedGraph();syncSettingsUI();
    render();syncTimelineDock();try{clearTimeout(autoSaveTimer);await queueWorkflowSave();}catch(error){setRunStatus(`Đã mở workflow nhưng chuyển ảnh/video thất bại: ${error?.message||String(error)}`,'warn');}}
  async function resetState(){if(state.isRunning)return;createUndoSnapshot('Làm mới workflow',{preserveRuntime:false});const s=starter();state.nodes=s.nodes;state.edges=s.edges;state.groups=[];state.notes=[];state.selectedNodeIds=[];state.selectedNodeId=null;render();await saveState();}
  function toggleProviderFields(){const provider=$('#providerSelect').value==='api'?'api':'flow';document.querySelectorAll('[data-provider]').forEach(el=>el.classList.toggle('hidden',el.dataset.provider!==provider));}
  function syncSettingsUI(){
    const s=state.settings||{};
    backendStatus.textContent=providerName()==='api'?'Tạo bằng: Gemini API (Veo) · v0.3.7':'Tạo bằng: tab Google Flow · v0.3.7';
    $('#providerSelect').value=providerName();$('#inputModeSelect').value=s.inputMode||'auto';$('#timeoutSelect').value=String(s.timeoutSec||900);
    $('#flowVideoModel').value=s.flowVideoModel||'';$('#flowImageModel').value=s.flowImageModel||'';$('#flowSelectors').value=s.flowSelectors||'';
    $('#apiVideoModel').value=s.apiVideoModel||'veo-3.1-fast-generate-preview';$('#apiImageModel').value=s.apiImageModel||'gemini-nano-banana-2.1';$('#apiResolution').value=s.apiResolution||'720p';
    getApiKey().then(key=>{$('#apiKeyInput').value=key;});
    toggleProviderFields();
  }
  async function saveSettingsForm(){
    const selectors=$('#flowSelectors').value.trim();
    if(selectors){try{JSON.parse(selectors);}catch(error){$('#connectionStatus').className='error';$('#connectionStatus').textContent=`Selector Flow không phải JSON hợp lệ: ${error.message}`;return false;}}
    state.settings={...(state.settings||{}),provider:$('#providerSelect').value,inputMode:$('#inputModeSelect').value,timeoutSec:Number($('#timeoutSelect').value)||900,flowVideoModel:$('#flowVideoModel').value.trim(),flowImageModel:$('#flowImageModel').value.trim(),flowSelectors:selectors,apiVideoModel:$('#apiVideoModel').value.trim(),apiImageModel:$('#apiImageModel').value.trim(),apiResolution:$('#apiResolution').value};
    await chrome.storage.local.set({thekeyGeminiApiKey:$('#apiKeyInput').value.trim()});
    syncSettingsUI();return true;
  }
  async function diagnoseFlowPage(){
    const output=$('#diagnoseOutput');output.classList.remove('hidden');output.textContent='Đang kiểm tra trang Flow…';
    try{const result=await museTabMessage({type:'THEKEY_FLOW_DIAGNOSE'});const text=JSON.stringify(result,null,2);output.textContent=text;try{await navigator.clipboard.writeText(text);output.textContent=`Đã chép vào clipboard, dán (Ctrl+V) gửi cho hỗ trợ.\n${text}`;}catch{}}
    catch(error){output.textContent=error.message;}
  }

  async function detectMuse(){
    try{
      if(providerName()==='api'){await testMuseSession();return;}
      const tabs=await chrome.tabs.query({url:FLOW_TAB_URLS});
      if(tabs.length){const active=tabs.find(t=>t.active)||tabs[0];await testMuseSession(active.id);}
      else{museStatus.textContent='● Hãy mở Google Flow và đăng nhập';museStatus.className='warn';}
    }catch{museStatus.textContent='● Không kiểm tra được Flow';museStatus.className='warn';}
  }

  document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>b.dataset.add==='text'?addTextNote():addNode(b.dataset.add));

  // Ready-made workflow: model photo + outfit photo → photo of the model wearing the outfit → fashion ad video.
  function addFashionPreset(){
    createUndoSnapshot('Mẫu quảng cáo thời trang');
    const bottoms=state.nodes.map(node=>node.y+(document.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`)?.offsetHeight||420)),x=state.nodes.length?Math.min(...state.nodes.map(node=>node.x)):Math.round((40-state.panX)/state.zoom),y=bottoms.length?Math.max(...bottoms)+120:Math.round((40-state.panY)/state.zoom),edge=(source,sourcePort,target,targetPort)=>({id:uid('edge'),source:source.id,sourcePort,target:target.id,targetPort});
    const model=makeNode('imageInput',x,y);model.data={role:'model'};
    const outfit=makeNode('imageInput',x,y+400);outfit.data={role:'outfit'};
    const photoPrompt=makeNode('prompt',x+320,y);photoPrompt.data={text:'Ảnh quảng cáo thời trang: người mẫu mặc đúng bộ trang phục này, tạo dáng toàn thân trong studio nền sáng, ánh sáng mềm, chi tiết vải rõ nét, phong cách tạp chí thời trang.'};
    const photo=makeNode('generateImage',x+640,y);photo.data={model:'',size:'9:16',status:'idle',outputRole:'startFrame',customName:'Tạo ảnh · Người mẫu mặc đồ'};
    const videoPrompt=makeNode('prompt',x+320,y+400);videoPrompt.data={text:'Người mẫu bước chậm về phía máy quay rồi xoay người khoe trọn bộ trang phục, vải chuyển động tự nhiên, máy quay lia nhẹ, ánh sáng studio, phong cách quảng cáo thời trang cao cấp.'};
    const video=makeNode('generateVideo',x+960,y+400);video.data={model:'',size:'9:16',duration:8,continuity:false,status:'idle',referenceMode:'firstFrame',customName:'Tạo video · Quảng cáo'};
    state.nodes.push(model,outfit,photoPrompt,photo,videoPrompt,video);
    state.edges.push(edge(model,'image',photo,'reference'),edge(outfit,'image',photo,'reference'),edge(photoPrompt,'text',photo,'prompt'),edge(photo,'image',video,'reference'),edge(videoPrompt,'text',video,'prompt'));
    render();const rect=$('#viewport').getBoundingClientRect();if(rect.width){state.zoom=Math.max(.35,Math.min(state.zoom,(rect.width-80)/1300));state.panX=40-x*state.zoom;state.panY=40-y*state.zoom;applyCanvasTransform();}saveState();
    setRunStatus('Đã thêm mẫu Quảng cáo thời trang: thả ảnh người mẫu và ảnh trang phục vào 2 node Ảnh đầu vào, rồi bấm Chạy tất cả.','ok');
  }
  $('#fashionPresetBtn')?.addEventListener('click',addFashionPreset);

  // Left node column: collapse to icons and remember the choice.
  (()=>{const sidebar=$('#nodeSidebar'),toggle=$('#nodeSidebarToggle');if(!sidebar||!toggle)return;const apply=collapsed=>{sidebar.classList.toggle('collapsed',collapsed);toggle.querySelector('.ns-label').textContent=collapsed?'Mở rộng':'Thu gọn';scheduleDrawEdges();};try{apply(localStorage.getItem('thekeyNodeSidebar')==='collapsed');}catch{}toggle.onclick=()=>{const next=!sidebar.classList.contains('collapsed');apply(next);try{localStorage.setItem('thekeyNodeSidebar',next?'collapsed':'open');}catch{}};})();

  // Image input from the computer: drop image files on the canvas or paste one with Ctrl+V.
  function readImageFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(reader.error||new Error('Không đọc được ảnh.'));reader.readAsDataURL(file);});}
  async function addImageInputs(files,clientX,clientY){
    const images=[...files].filter(file=>/^image\//.test(file.type));
    if(!images.length){setRunStatus('Chỉ file ảnh mới tạo được node Ảnh đầu vào.','warn');return;}
    const rect=$('#viewport').getBoundingClientRect(),baseX=((clientX??rect.left+rect.width/2)-rect.left-state.panX)/state.zoom-135,baseY=((clientY??rect.top+rect.height/2)-rect.top-state.panY)/state.zoom-90;
    const dropTarget=clientX!==undefined&&document.elementFromPoint(clientX,clientY)?.closest('.node'),targetNode=dropTarget&&nodeById(dropTarget.dataset.id);
    const selected=state.selectedNodeId&&nodeById(state.selectedNodeId);
    let filled=0;
    for(const [index,file] of images.entries()){
      const url=await readImageFile(file);
      // Dropped on an Image Input (or pasted while an empty one is selected): fill that node instead of adding one.
      const reuse=index===0&&(['imageInput','character'].includes(targetNode?.type)?targetNode:clientX===undefined&&['imageInput','character'].includes(selected?.type)&&!selected.data.localDataUrl?selected:null);
      if(reuse){createUndoSnapshot('Đổi ảnh');reuse.data.localDataUrl=url;delete reuse.data.asset;filled++;continue;}
      addNode('imageInput',baseX+index*290,baseY);const node=state.nodes.at(-1);node.data.localDataUrl=url;filled++;
    }
    render();saveState();setRunStatus(`Đã thêm ${filled} ảnh. Nối cổng “ảnh” sang “ảnh tham chiếu” của Tạo ảnh / Tạo video, và chọn vai trò cho ảnh.`,'ok');
  }
  (()=>{const viewport=$('#viewport');let depth=0;const hasFiles=event=>[...(event.dataTransfer?.types||[])].includes('Files');
    viewport.addEventListener('dragenter',event=>{if(!hasFiles(event))return;depth++;viewport.classList.add('file-drop-target');});
    viewport.addEventListener('dragover',event=>{if(!hasFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect='copy';});
    viewport.addEventListener('dragleave',event=>{if(!hasFiles(event))return;depth=Math.max(0,depth-1);if(!depth)viewport.classList.remove('file-drop-target');});
    viewport.addEventListener('drop',event=>{if(!hasFiles(event))return;event.preventDefault();depth=0;viewport.classList.remove('file-drop-target');addImageInputs(event.dataTransfer.files,event.clientX,event.clientY).catch(error=>setRunStatus(error.message,'error'));});
    document.addEventListener('paste',event=>{if(isTextEntry(event.target)||document.querySelector('.modal-backdrop:not(.hidden)'))return;const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file'&&/^image\//.test(item.type)).map(item=>item.getAsFile()).filter(Boolean);if(!files.length)return;event.preventDefault();addImageInputs(files).catch(error=>setRunStatus(error.message,'error'));});
  })();
  $('#scriptImportBtn').onclick=()=>{$('#scriptModal').classList.remove('hidden');$('#scriptImportStatus').textContent='';$('#scriptInput').focus();};
  $('#cancelScriptImport').onclick=()=>$('#scriptModal').classList.add('hidden');
  $('#buildScriptNodes').onclick=buildSceneNodesFromScript;
  $('#scriptModal').onclick=event=>{if(event.target.id==='scriptModal')$('#scriptModal').classList.add('hidden');};
  $('#scriptInput').addEventListener('input',()=>{const count=parseSceneScript($('#scriptInput').value).length;$('#scriptImportStatus').className='';$('#scriptImportStatus').textContent=count?`${count} scene${count===1?'':'s'} detected.`:'';});
  $('#timelineToggleBtn').onclick=toggleTimeline;
  $('#timelineExportBtn').onclick=exportTimelineVideo;
  $('#timelineExportStopBtn').onclick=stopTimelineExport;
  $('#timelineImportAllBtn').onclick=importAllVideosToTimeline;
  $('#closeTimelinePreview').onclick=closeTimelinePreview;
  $('#timelineAddVideoBtn').onclick=toggleTimelineOutputMenu;
  $('#timelinePlayBtn').onclick=()=>playTimeline(ensureDockTimeline());
  // A DOM click handler receives the MouseEvent as its first argument. Keep
  // Keep toolbar workflow execution separate from the per-node generation action.
  $('#runBtn').onclick=onWorkflowRunButtonClick; $('#saveBtn').onclick=saveState; $('#resetBtn').onclick=resetState;
  $('#workflowExportBtn').onclick=exportWorkflowFile;
  $('#workflowImportBtn').onclick=()=>$('#workflowFileInput').click();
  $('#workflowFileInput').onchange=event=>{const file=event.target.files?.[0];event.target.value='';if(file)void importWorkflowFile(file);};
  $('#settingsBtn').onclick=()=>{syncSettingsUI();$('#connectionStatus').textContent='';$('#diagnoseOutput').classList.add('hidden');$('#settingsModal').classList.remove('hidden');};
  $('#providerSelect').onchange=toggleProviderFields;
  $('#diagnoseFlowBtn').onclick=diagnoseFlowPage;
  const openGuide=()=>{window.open(chrome.runtime.getURL('guide.html'),'thekey-guide');};
  $('#guideBtn').onclick=openGuide;
  $('#welcomeGuideBtn').onclick=()=>{$('#welcomeModal').classList.add('hidden');openGuide();};
  $('#welcomeBtn').onclick=()=>$('#welcomeModal').classList.remove('hidden');
  $('#closeWelcomeBtn').onclick=()=>$('#welcomeModal').classList.add('hidden');
  $('#welcomeModal').onclick=event=>{if(event.target.id==='welcomeModal')$('#welcomeModal').classList.add('hidden');};
  $('#testMuseBtn').onclick=async()=>{if(await saveSettingsForm())testMuseSession();};
  $('#closeSettingsBtn').onclick=()=>$('#settingsModal').classList.add('hidden');
  $('#saveSettingsBtn').onclick=async()=>{if(!(await saveSettingsForm()))return;$('#settingsModal').classList.add('hidden');await saveState();detectMuse();};
  $('#settingsModal').onclick=(e)=>{if(e.target.id==='settingsModal')$('#settingsModal').classList.add('hidden');};
  window.addEventListener('resize',drawEdges);
  window.addEventListener('pointermove',onWireMove);
  window.addEventListener('pointermove',moveSelectionMarquee);
  window.addEventListener('pointermove',moveGroupMarquee);window.addEventListener('pointermove',moveTextNote);
  window.addEventListener('pointerup',onWireUp);
  window.addEventListener('pointerup',endSelectionMarquee);
  window.addEventListener('pointerup',finishGroupMarquee);window.addEventListener('pointerup',finishTextNoteMove);
  window.addEventListener('pointercancel',endSelectionMarquee);
  window.addEventListener('pointercancel',cancelGroupMarquee);window.addEventListener('pointercancel',finishTextNoteMove);
  $('#viewport').addEventListener('wheel',event=>{event.preventDefault();const factor=Math.exp(-event.deltaY*.0015);zoomAt(event.clientX,event.clientY,factor);},{passive:false});
  $('#viewport').addEventListener('pointerdown',event=>{const panGesture=event.button===1||state.spaceDown||state.handMode;if(panGesture&&!event.target.closest('button,input,label,textarea,select,video,a,.canvas-tools,.canvas-note'))startPan(event);});
  $('#viewport').addEventListener('pointerdown',startSelectionMarquee);
  document.addEventListener('pointerdown',event=>{const stop=event.target.closest('[data-stop-generation]');if(!stop)return;if(event.pointerType==='mouse'&&event.detail>1)return;event.preventDefault();event.stopImmediatePropagation();stopGeneration(stop.dataset.stopGeneration);},true);
  window.addEventListener('pointermove',movePan);window.addEventListener('pointerup',endPan);window.addEventListener('pointercancel',endPan);
  $('#handTool').onclick=()=>{state.handMode=!state.handMode;applyCanvasTransform();$('#handTool').classList.toggle('active',state.handMode);};
  $('#groupTool').onclick=()=>setGroupDrawMode(!state.groupDrawMode);
  $('#zoomIn').onclick=()=>setZoom(Math.min(2.5,state.zoom*1.15));$('#zoomOut').onclick=()=>setZoom(Math.max(.25,state.zoom/1.15));$('#fitCanvas').onclick=fitCanvas;
  $('#viewport').addEventListener('contextmenu',openCanvasMenu);
  const trackUndoEdit=event=>{const target=event.target;if(!target.closest('.node,.canvas-note,.timeline-dock,#settingsModal'))return;const owner=target.closest('.node'),title=owner?.querySelector('.node-title')?.textContent||'ghi chú';if(pendingNativeUndoTarget===target){if(lastUndoInput===target&&undoStack.at(-1)?.label===`Sửa ${title}`)undoStack.pop();lastUndoInput=null;pendingNativeUndoTarget=null;return;}if(lastUndoInput!==target){createUndoSnapshot(`Sửa ${title}`);lastUndoInput=target;}};
  document.addEventListener('input',event=>{trackUndoEdit(event);if(event.target.closest('.node,.canvas-note,.timeline-dock,#settingsModal'))scheduleAutoSave();},true);
  document.addEventListener('change',event=>{trackUndoEdit(event);if(event.target.closest('.node,.canvas-note,.timeline-dock,#settingsModal'))scheduleAutoSave();},true);
  document.addEventListener('focusout',event=>{if(event.target===lastUndoInput)lastUndoInput=null;},true);
  $('#canvasMenu').addEventListener('click',e=>{const item=e.target.closest('[data-context-action]');if(!item)return;if(item.dataset.contextAction==='connect-choice')runConnectionChoice(Number(item.dataset.choice));else runCanvasAction(item.dataset.contextAction);});
  edgesSvg.addEventListener('contextmenu',openEdgeMenu);
  edgesSvg.addEventListener('pointerdown',selectEdgePointer);
  canvas.addEventListener('contextmenu',openCanvasMenu);
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#canvasMenu')){closeCanvasMenu();state.pendingConnection=null;}});
  const isTextEntry=target=>Boolean(target?.closest?.('textarea,input,select,[contenteditable="true"]'));
  const isTextEditor=target=>Boolean(target?.closest?.('textarea,input:not([type="checkbox"]):not([type="number"]):not([type="file"]):not([type="range"]):not([type="color"]),[contenteditable="true"]'));
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey){
      if(isTextEditor(e.target)){
        pendingNativeUndoTarget=e.target;setTimeout(()=>{if(pendingNativeUndoTarget===e.target)pendingNativeUndoTarget=null;},0);return;
      }
      e.preventDefault();undoLastChange();return;
    }
    if(e.code==='Space'&&!isTextEntry(e.target)){
      // Space is a temporary canvas hand key. Prevent native activation of a
      // focused toolbar button (Run/Stop) on both press and release.
      e.preventDefault();
      if(!e.repeat){state.spaceDown=true;applyCanvasTransform();if(document.activeElement?.matches?.('button'))document.activeElement.blur();}
      return;
    }
    if(e.key==='Escape'){closeCanvasMenu();endSelectionMarquee();cancelGroupMarquee();$('#welcomeModal').classList.add('hidden');}
    if((e.key==='Delete'||e.key==='Backspace')&&!isTextEntry(e.target)){e.preventDefault();if(state.selectedEdgeIds.length){const ids=new Set(state.selectedEdgeIds);createUndoSnapshot(`Xoá ${ids.size} dây nối`);state.edges=state.edges.filter(edge=>!ids.has(edge.id));state.selectedEdgeIds=[];render();saveState();setRunStatus('Đã xoá các dây đang chọn.','ok');}else removeSelectedNodes();}
    if(e.key.toLowerCase()==='h'&&!isTextEntry(e.target)){state.handMode=!state.handMode;$('#handTool').classList.toggle('active',state.handMode);applyCanvasTransform();}
    if(!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!isTextEntry(e.target)&&e.key.toLowerCase()==='g'){e.preventDefault();setGroupDrawMode(!state.groupDrawMode);}
    if(!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!isTextEntry(e.target)&&e.key.toLowerCase()==='t'){e.preventDefault();setGroupDrawMode(false);const rect=$('#viewport').getBoundingClientRect();addTextNote((rect.width/2-state.panX)/state.zoom-130,(rect.height/2-state.panY)/state.zoom-80);}
  },true);
  document.addEventListener('keyup',e=>{if(e.key.toLowerCase()==='z'&&pendingNativeUndoTarget===e.target)pendingNativeUndoTarget=null;if(e.code==='Space'&&!isTextEntry(e.target)){e.preventDefault();state.spaceDown=false;applyCanvasTransform();}},true);
  window.addEventListener('blur',()=>{state.spaceDown=false;endPan();endSelectionMarquee();cancelGroupMarquee();applyCanvasTransform();});

  // Keep the session indicator fresh when Flow is opened/reloaded after the canvas.
  chrome.tabs.onUpdated.addListener((tabId,changeInfo,tab)=>{
    if(changeInfo.status==='complete'&&providerName()==='flow'&&FLOW_TAB_RX.test(tab.url||''))testMuseSession(tabId);
  });
  chrome.tabs.onCreated.addListener(tab=>{
    if(providerName()==='flow'&&FLOW_TAB_RX.test(tab.url||''))setTimeout(()=>testMuseSession(tab.id),1200);
  });

  loadState().then(detectMuse);applyCanvasTransform();$('#welcomeModal').classList.remove('hidden');
})();
