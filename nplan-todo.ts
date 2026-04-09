export function formatTodoList(items: Array<{ step: number; text: string; completed: boolean }>): {
	todoList: string;
	completedCount: number;
	totalCount: number;
	remainingCount: number;
} {
	const totalCount = items.length;
	const completedCount = items.filter((item) => item.completed).length;
	const remainingItems = items.filter((item) => !item.completed);
    const todoList = remainingItems.length
		? remainingItems.map((item) => `- [ ] ${item.step}. ${item.text}`).join("\n")
		: "";
	return {
		todoList,
		completedCount,
		totalCount,
		remainingCount: remainingItems.length,
	};
}