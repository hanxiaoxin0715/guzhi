import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useState,
  } from 'react'
  
  export default forwardRef((props: any, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
  
    const selectItem = (index: number) => {
      const item = props.items[index]
  
      if (item) {
        props.command({ id: item })
      }
    }
  
    const upHandler = () => {
      setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
    }
  
    const downHandler = () => {
      setSelectedIndex((selectedIndex + 1) % props.items.length)
    }
  
    const enterHandler = () => {
      selectItem(selectedIndex)
    }
  
    useEffect(() => setSelectedIndex(0), [props.items])
  
    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: any) => {
        if (event.key === 'ArrowUp') {
          upHandler()
          return true
        }
  
        if (event.key === 'ArrowDown') {
          downHandler()
          return true
        }
  
        if (event.key === 'Enter') {
          enterHandler()
          return true
        }
  
        return false
      },
    }))
  
    return (
      <div className="items bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-lg overflow-hidden min-w-[200px]">
        {props.items.length ? (
          props.items.map((item: any, index: number) => (
            <button
              className={`item w-full text-left px-3 py-2 text-[13px] flex items-center justify-between ${
                index === selectedIndex ? 'bg-[var(--gold-primary)]/10 text-[var(--gold-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-page)]'
              }`}
              key={index}
              onClick={() => selectItem(index)}
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-page)] rounded border border-[var(--border-subtle)] text-[var(--text-muted)]">
                  {item.role || "设定"}
              </span>
            </button>
          ))
        ) : (
          <div className="item p-3 text-[13px] text-[var(--text-muted)]">No result</div>
        )}
      </div>
    )
  })
