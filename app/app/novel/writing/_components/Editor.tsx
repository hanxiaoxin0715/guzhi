
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Mention } from './suggestion'
import MentionList from './MentionList'
import tippy from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import { useEffect } from 'react'

interface EditorProps {
    content: string;
    onUpdate: (content: string) => void;
    project: any;
    fontSize: number;
    lineHeight: number;
    fontFamily: "serif" | "sans" | "mono";
}

const Editor = ({ content, onUpdate, project, fontSize, lineHeight, fontFamily }: EditorProps) => {
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit,
            Mention.configure({
                HTMLAttributes: {
                    class: 'mention text-[var(--gold-primary)] bg-[var(--gold-primary)]/10 px-1 rounded cursor-pointer font-medium',
                },
                suggestion: {
                    items: ({ query }) => {
                        if (!project || !project.characters) return [];
                        return project.characters
                            .filter((item: any) => item.name.toLowerCase().startsWith(query.toLowerCase()))
                            .slice(0, 5)
                            .map((char: any) => ({ name: char.name, role: char.role }));
                    },
                    render: () => {
                        let component: any;
                        let popup: any;

                        return {
                            onStart: (props: any) => {
                                component = new ReactRenderer(MentionList, {
                                    props,
                                    editor: props.editor,
                                })

                                if (!props.clientRect) {
                                    return
                                }

                                popup = tippy('body', {
                                    getReferenceClientRect: props.clientRect,
                                    appendTo: () => document.body,
                                    content: component.element,
                                    showOnCreate: true,
                                    interactive: true,
                                    trigger: 'manual',
                                    placement: 'bottom-start',
                                })
                            },
                            onUpdate(props: any) {
                                component.updateProps(props)

                                if (!props.clientRect) {
                                    return
                                }

                                popup[0].setProps({
                                    getReferenceClientRect: props.clientRect,
                                })
                            },
                            onKeyDown(props: any) {
                                if (props.event.key === 'Escape') {
                                    popup[0].hide()
                                    return true
                                }
                                return component.ref?.onKeyDown(props)
                            },
                            onExit() {
                                popup[0].destroy()
                                component.destroy()
                            },
                        }
                    }
                }
            }),
        ],
        content: content,
        onUpdate: ({ editor }) => {
            onUpdate(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'prose max-w-none outline-none focus:outline-none h-full',
                style: 'background:transparent; color:rgba(255,255,255,0.85);'
            },
        },
    })

    // Sync editor content when prop changes (e.g. switching chapters)
    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            editor.commands.setContent(content);
        }
    }, [content, editor]);

    const getFontFamilyClass = () => {
        switch(fontFamily) {
            case "sans": return "font-sans";
            case "mono": return "font-mono";
            default: return "font-serif";
        }
    };

    if (!editor) {
        return null
    }

    return (
        <EditorContent 
            editor={editor} 
            className={`w-full max-w-[800px] h-full p-12 border-none outline-none resize-none ${getFontFamilyClass()}`}
            style={{
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                color: 'rgba(255,255,255,0.85)',
                background: 'transparent'
            }}
        />
    )
}

export default Editor
